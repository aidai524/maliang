/**
 * 即梦AI (Jimeng/Seedream 4.0) 客户端
 * 
 * 使用火山方舟 OpenAI 兼容 API
 * 文档: https://www.volcengine.com/docs/82379/1824121
 */

import { ProviderError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { sleep } from '../../utils/sleep';
import { getEndpointConfig, DEFAULT_ENDPOINT } from './endpoints';
import type {
  JimengGenerateOptions,
  JimengSubmitResult,
  JimengStatusResult,
  JimengResolution,
  JimengAspectRatio,
  JimengGenerationMode,
} from './types';

const logger = createLogger('jimeng');

/**
 * 解析 Base64 图片数据，转为 URL 格式
 * 火山方舟支持 data URI 格式
 */
function formatImageInput(dataUrl: string): string {
  // 火山方舟支持直接传入 data:image/xxx;base64,xxx 格式
  return dataUrl;
}

/**
 * 将分辨率转换为 size 参数
 */
function resolutionToSize(resolution?: JimengResolution): string {
  switch (resolution) {
    case '1K': return '1K';
    case '2K': return '2K';
    case '4K': return '4K';
    default: return '2K';
  }
}

/**
 * 火山方舟 API 响应结构
 */
interface ArkImageResponse {
  created: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * 提交即梦AI生成任务并等待结果
 * 火山方舟 API 是同步的，直接返回结果
 */
export async function jimengSubmit(
  options: JimengGenerateOptions
): Promise<JimengSubmitResult> {
  const {
    apiKey,
    prompt,
    inputImage,
    referenceImages,
    generationMode = 'text_to_image',
    resolution = '2K',
    aspectRatio,
    sampleCount = 1,
    watermark = false,
    modelVersion,
  } = options;

  const endpoint = getEndpointConfig(DEFAULT_ENDPOINT);
  const model = modelVersion || endpoint.model;

  // 构建请求体 (OpenAI 兼容格式)
  const requestBody: Record<string, any> = {
    model,
    prompt,
    size: resolutionToSize(resolution),
    n: Math.min(Math.max(sampleCount, 1), 15),
    response_format: 'url',
    watermark,
  };

  // 处理参考图
  // 优先使用 referenceImages，兼容 inputImage
  const images = referenceImages && referenceImages.length > 0
    ? referenceImages
    : inputImage ? [inputImage] : [];

  if (images.length > 0) {
    // 火山方舟支持 image 参数（单图或数组）
    // 对于图生图模式，传入参考图数组
    if (images.length === 1) {
      requestBody.image = formatImageInput(images[0]);
    } else {
      requestBody.image = images.map(formatImageInput);
    }
  }

  const url = `${endpoint.baseUrl}/images/generations`;

  logger.info('Submitting to Jimeng API (Ark)', {
    model,
    generationMode,
    referenceImageCount: images.length,
    resolution,
    sampleCount,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    
    logger.debug('Jimeng API response', {
      status: response.status,
      responseLength: responseText.length,
    });

    let data: ArkImageResponse;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new ProviderError(
        `Jimeng API returned invalid JSON: ${responseText.substring(0, 200)}`,
        'JIMENG_INVALID_RESPONSE'
      );
    }

    // 检查错误
    if (data.error) {
      handleJimengError(response.status, data.error.message, data.error.code);
    }

    if (!response.ok) {
      throw new ProviderError(
        `Jimeng API error (${response.status}): ${responseText.substring(0, 200)}`,
        'JIMENG_API_ERROR'
      );
    }

    const requestId = `jimeng_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // 缓存结果以供后续 poll 使用
    responseCache.set(requestId, data);
    setTimeout(() => responseCache.delete(requestId), 5 * 60 * 1000);

    logger.info('Jimeng submit successful', {
      requestId,
      imageCount: data.data?.length || 0,
    });

    return {
      taskId: requestId,
      model,
    };
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    logger.error('Jimeng submit failed', { error });
    throw new ProviderError(
      `Jimeng submit failed: ${error}`,
      'JIMENG_SUBMIT_ERROR'
    );
  }
}

// 响应缓存
const responseCache = new Map<string, ArkImageResponse>();

/**
 * 轮询即梦AI任务状态
 * 火山方舟 API 是同步的，这里直接从缓存获取结果
 */
export async function jimengPoll(
  taskId: string,
  _apiKey: string
): Promise<JimengStatusResult> {
  const cached = responseCache.get(taskId);

  if (!cached) {
    return {
      status: 'FAILED',
      error: 'Response not found - may have expired',
    };
  }

  // 解析结果
  if (!cached.data || cached.data.length === 0) {
    return {
      status: 'FAILED',
      error: 'No images generated',
    };
  }

  const images: { url: string; mimeType: string }[] = [];

  for (const item of cached.data) {
    if (item.url) {
      images.push({
        url: item.url,
        mimeType: 'image/png',
      });
    } else if (item.b64_json) {
      images.push({
        url: `data:image/png;base64,${item.b64_json}`,
        mimeType: 'image/png',
      });
    }
  }

  if (images.length === 0) {
    return {
      status: 'FAILED',
      error: 'No valid images in response',
    };
  }

  return {
    status: 'SUCCEEDED',
    images,
  };
}

/**
 * 完整的生成流程：提交 + 轮询
 */
export async function jimengGenerate(
  options: JimengGenerateOptions,
  pollOptions: {
    maxAttempts?: number;
    intervalMs?: number;
  } = {}
): Promise<JimengStatusResult & { status: 'SUCCEEDED' | 'FAILED'; model?: string }> {
  // 火山方舟 API 是同步的，直接提交并获取结果
  const { taskId, model } = await jimengSubmit(options);

  // 立即获取结果（已经在 submit 时缓存了）
  const result = await jimengPoll(taskId, options.apiKey);

  if (result.status === 'SUCCEEDED') {
    return { status: 'SUCCEEDED', images: result.images, model };
  }

  return { status: 'FAILED', error: result.error, model };
}

/**
 * 处理即梦API错误
 */
function handleJimengError(status: number, message: string, code?: string): never {
  let errorCode = 'JIMENG_ERROR';
  let retryable = true;

  if (status === 400 || code === 'invalid_request_error') {
    errorCode = 'INVALID_REQUEST';
    retryable = false;
  } else if (status === 401 || code === 'authentication_error') {
    errorCode = 'INVALID_API_KEY';
    retryable = false;
  } else if (status === 402 || code === 'insufficient_quota') {
    errorCode = 'INSUFFICIENT_BALANCE';
    retryable = false;
  } else if (status === 429 || code === 'rate_limit_exceeded') {
    errorCode = 'RATE_LIMIT_EXCEEDED';
    retryable = true;
  } else if (status >= 500) {
    errorCode = 'SERVICE_OVERLOAD';
    retryable = true;
  }

  throw new ProviderError(
    `Jimeng API error (${status}): ${message}`,
    errorCode,
    retryable
  );
}
