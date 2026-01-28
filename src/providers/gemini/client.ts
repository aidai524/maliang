import { config } from '../../config/env';
import { ProviderError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { sleep } from '../../utils/sleep';
import type {
  GeminiGenerateOptions,
  GeminiSubmitResult,
  GeminiStatusResult,
  GeminiMode,
  GeminiResolution,
  GeminiAspectRatios,
  GenerationConfig,
  GeminiGenerateContentRequest,
} from './types';

const logger = createLogger('gemini');

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.0-pro-vision';

function buildGeminiRequest(
  prompt: string,
  inputImageUrl: string | undefined,
  mode: GeminiMode,
  resolution?: '1:1' | '4:3',
  aspectRatio?: GeminiAspectRatios,
  sampleCount?: number,
) {
  const generationConfig: GenerationConfig = {
    temperature: mode === 'draft' ? 0.7 : 1,
    // Enable image generation output
    responseModalities: ['TEXT', 'IMAGE'],
  };

  if (resolution) {
    generationConfig.imageConfig = {
      imageSize: resolution,
    };
  }

  if (aspectRatio) {
    if (!generationConfig.imageConfig) {
      generationConfig.imageConfig = {};
    }
    generationConfig.imageConfig.aspectRatio = aspectRatio;
  }

  const parts: any[] = [];

  // Prepend "Generate an image of" to help the model understand the intent
  const imagePrompt = `Generate an image: ${prompt}`;

  if (sampleCount && sampleCount > 1) {
    for (let i = 0; i < sampleCount; i++) {
      parts.push({ text: imagePrompt });
    }
  } else {
    parts.push({ text: imagePrompt });
  }

  if (inputImageUrl) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: inputImageUrl,
      },
    });
  }

  return {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig,
  };
}

export async function geminiSubmit(
  options: GeminiGenerateOptions
): Promise<GeminiSubmitResult> {
  const { apiKey, prompt, inputImageUrl, mode = 'final', resolution, aspectRatio, sampleCount, model: optionModel } = options;

  const apiBase = config.gemini.apiBase || DEFAULT_API_BASE;
  const model = optionModel || config.gemini.model || DEFAULT_MODEL;

  const requestBody = buildGeminiRequest(
    prompt,
    inputImageUrl,
    mode || 'final',
    resolution && resolution === '1K' ? '1:1' : resolution === '2K' ? '4:3' : undefined,
    aspectRatio,
    sampleCount
  );

  const url = `${apiBase}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  logger.info('Submitting to Gemini API', {
    model,
    mode: mode || 'final',
    hasInputImage: !!inputImageUrl,
    resolution,
    aspectRatio,
    sampleCount,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      handleGeminiError(response.status, errorText);
    }

    const data = (await response.json()) as any;

    const requestId = `gemini_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    await cacheGeminiResponse(requestId, data);

    logger.info('Gemini submit successful', { requestId });

    return { requestId, model };
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    logger.error('Gemini submit failed', { error });
    throw new ProviderError(
      `Gemini submit failed ${error}`,
      'GEMINI_SUBMIT_ERROR'
    );
  }
}

export async function geminiPoll(
  requestId: string,
  apiKey: string
): Promise<GeminiStatusResult> {
  const cached = await getCachedGeminiResponse(requestId);

  if (cached) {
    return parseGeminiResponse(cached);
  }

  logger.warn('No cached response found', { requestId });

  return {
    status: 'FAILED',
    error: 'Response not found - may have expired',
  };
}

export async function geminiGenerate(
  options: GeminiGenerateOptions,
  pollOptions: {
    maxAttempts?: number;
    intervalMs?: number;
    enableFallback?: boolean;
  } = {}
): Promise<GeminiStatusResult & { status: 'SUCCEEDED' | 'FAILED'; model?: string }> {
  const { maxAttempts = 60, intervalMs = 3000, enableFallback = true } = pollOptions;

  const { requestId, model } = await geminiSubmit(options);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await geminiPoll(requestId, options.apiKey);

      if (result.status === 'SUCCEEDED') {
        return { status: result.status, images: result.images, model };
      }

      if (result.status === 'FAILED') {
        return { status: result.status, error: result.error, model };
      }

      await sleep(intervalMs);
    } catch (error) {
      const isProviderError = error instanceof ProviderError;

      if (isProviderError) {
        const providerError = error as ProviderError;

        if (providerError.code === 'SERVICE_OVERLOAD' && enableFallback) {
          logger.info('503 error detected, enabling fallback strategy', { attempt });

          try {
            const fallbackModel = 'gemini-2.5-flash-image-preview';
            const fallbackOptions = { ...options, model: fallbackModel };

            logger.info('Retrying with fallback model', { fallbackModel });
            const { requestId: fallbackRequestId } = await geminiSubmit(fallbackOptions as any);

            const fallbackResult = await geminiPoll(fallbackRequestId, options.apiKey);

            if (fallbackResult.status === 'SUCCEEDED') {
              return { status: fallbackResult.status, images: fallbackResult.images, model: fallbackModel };
            }

            if (fallbackResult.status === 'FAILED') {
              return { status: fallbackResult.status, error: fallbackResult.error, model: fallbackModel };
            }
          } catch (fallbackError: any) {
            logger.error('Fallback model also failed', { error: fallbackError.message });
            throw fallbackError;
          }
        }
      }

      throw error;
    }
  }

  return {
    status: 'FAILED',
    error: 'Max attempts reached',
    model,
  };
}

function handleGeminiError(status: number, errorText: string): never {
  let code = 'GEMINI_ERROR';
  let retryable = true;

  if (status === 400) {
    code = 'INVALID_REQUEST';
    retryable = false;
  } else if (status === 401) {
    code = 'INVALID_API_KEY';
    retryable = false;
  } else if (status === 429) {
    code = 'RATE_LIMIT_EXCEEDED';
    retryable = true;
  } else if (status === 503) {
    code = 'SERVICE_OVERLOAD';
    retryable = true;
    logger.warn('Gemini API 503 - Service overloaded', { status, errorText });
  } else if (status >= 500) {
    code = 'SERVER_ERROR';
    retryable = true;
  }

  throw new ProviderError(
    `Gemini API error (${status}): ${errorText}`,
    code,
    retryable
  );
}

function parseGeminiResponse(data: any): GeminiStatusResult {
  if (data.error) {
    return {
      status: 'FAILED',
      error: data.error.message || 'Unknown error',
    };
  }

  const candidates = data.candidates || [];

  if (candidates.length === 0) {
    return {
      status: 'FAILED',
      error: 'No candidates in response',
    };
  }

  const parts = candidates[0].content?.parts || [];
  const images: Array<{ url: string; mimeType: string }> = [];

  for (const part of parts) {
    if (part.inlineData) {
      const { mimeType, data: base64Data } = part.inlineData;
      images.push({
        url: `data:${mimeType};base64,${base64Data}`,
        mimeType,
      });
    }
  }

  if (images.length === 0) {
    return {
      status: 'FAILED',
      error: 'No images generated',
    };
  }

  return {
    status: 'SUCCEEDED',
    images,
  };
}

const responseCache = new Map<string, any>();

async function cacheGeminiResponse(requestId: string, data: any): Promise<void> {
  responseCache.set(requestId, data);

  setTimeout(() => {
    responseCache.delete(requestId);
  }, 5 * 60 * 1000);
}

async function getCachedGeminiResponse(requestId: string): Promise<any | null> {
  return responseCache.get(requestId) || null;
}
