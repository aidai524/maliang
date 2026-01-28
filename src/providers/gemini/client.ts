import { config } from '../../config/env';
import { ProviderError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { sleep } from '../../utils/sleep';
import { buildApiUrl, getEndpointConfig, GEMINI_ENDPOINTS } from './endpoints';
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

const DEFAULT_ENDPOINT = 'official';
const DEFAULT_MODEL = 'gemini-3.0-pro-vision';

/**
 * Parse base64 image data URL and extract mimeType and data
 * Format: data:image/<type>;base64,<data>
 */
function parseBase64Image(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function buildGeminiRequest(
  prompt: string,
  inputImage: string | undefined,
  mode: GeminiMode,
  resolution?: GeminiResolution,
  aspectRatio?: GeminiAspectRatios,
  sampleCount?: number,
) {
  const generationConfig: GenerationConfig = {
    temperature: mode === 'draft' ? 0.7 : 1,
    // Enable image generation output
    responseModalities: ['TEXT', 'IMAGE'],
  };

  // Set image configuration if resolution or aspectRatio is provided
  if (resolution || aspectRatio || sampleCount) {
    generationConfig.imageConfig = {};
    
    if (resolution) {
      generationConfig.imageConfig.imageSize = resolution;
    }
    
    if (aspectRatio) {
      generationConfig.imageConfig.aspectRatio = aspectRatio;
    }
    
    if (sampleCount && sampleCount > 1) {
      generationConfig.imageConfig.numberOfImages = sampleCount;
    }
  }

  const parts: any[] = [];

  // Add input image first if provided (reference image)
  if (inputImage) {
    const parsed = parseBase64Image(inputImage);
    if (parsed) {
      parts.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.data,
        },
      });
    }
  }

  // Prepend "Generate an image of" to help the model understand the intent
  const imagePrompt = `Generate an image: ${prompt}`;

  if (sampleCount && sampleCount > 1) {
    for (let i = 0; i < sampleCount; i++) {
      parts.push({ text: imagePrompt });
    }
  } else {
    parts.push({ text: imagePrompt });
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
  const { 
    apiKey, 
    prompt, 
    inputImage, 
    mode = 'final', 
    resolution, 
    aspectRatio, 
    sampleCount, 
    model: optionModel,
    endpoint: optionEndpoint,
  } = options;

  const endpoint = optionEndpoint || DEFAULT_ENDPOINT;
  const model = optionModel || config.gemini.model || DEFAULT_MODEL;

  const requestBody = buildGeminiRequest(
    prompt,
    inputImage,
    mode || 'final',
    resolution,
    aspectRatio,
    sampleCount
  );

  // Build URL and headers based on endpoint configuration
  const { url, headers } = buildApiUrl(endpoint, model, apiKey);

  logger.info('Submitting to Gemini API', {
    endpoint,
    model,
    mode: mode || 'final',
    hasInputImage: !!inputImage,
    resolution,
    aspectRatio,
    sampleCount,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      handleGeminiError(response.status, errorText, endpoint);
    }

    const data = (await response.json()) as any;

    const requestId = `gemini_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    await cacheGeminiResponse(requestId, data);

    logger.info('Gemini submit successful', { requestId, endpoint });

    return { requestId, model, endpoint };
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    logger.error('Gemini submit failed', { error, endpoint });
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
    fallbackEndpoints?: string[];
  } = {}
): Promise<GeminiStatusResult & { status: 'SUCCEEDED' | 'FAILED'; model?: string; endpoint?: string }> {
  const { 
    maxAttempts = 60, 
    intervalMs = 3000, 
    enableFallback = true,
    fallbackEndpoints = ['yunwu'],  // Default fallback to yunwu
  } = pollOptions;

  const { requestId, model, endpoint } = await geminiSubmit(options);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await geminiPoll(requestId, options.apiKey);

      if (result.status === 'SUCCEEDED') {
        return { status: result.status, images: result.images, model, endpoint };
      }

      if (result.status === 'FAILED') {
        return { status: result.status, error: result.error, model, endpoint };
      }

      await sleep(intervalMs);
    } catch (error) {
      const isProviderError = error instanceof ProviderError;

      if (isProviderError) {
        const providerError = error as ProviderError;

        // Handle 503 with endpoint fallback
        if (providerError.code === 'SERVICE_OVERLOAD' && enableFallback) {
          logger.info('503 error detected, attempting endpoint fallback', { 
            attempt, 
            currentEndpoint: endpoint,
            fallbackEndpoints,
          });

          // Try fallback endpoints
          for (const fallbackEndpoint of fallbackEndpoints) {
            // Skip if same as current endpoint
            if (fallbackEndpoint === endpoint) continue;

            try {
              logger.info('Trying fallback endpoint', { fallbackEndpoint, model });
              
              const fallbackOptions = { 
                ...options, 
                endpoint: fallbackEndpoint,
              };

              const { requestId: fallbackRequestId, endpoint: usedEndpoint } = 
                await geminiSubmit(fallbackOptions);

              const fallbackResult = await geminiPoll(fallbackRequestId, options.apiKey);

              if (fallbackResult.status === 'SUCCEEDED') {
                logger.info('Fallback endpoint succeeded', { fallbackEndpoint });
                return { 
                  status: fallbackResult.status, 
                  images: fallbackResult.images, 
                  model, 
                  endpoint: usedEndpoint,
                };
              }

              if (fallbackResult.status === 'FAILED') {
                logger.warn('Fallback endpoint failed', { 
                  fallbackEndpoint, 
                  error: fallbackResult.error,
                });
                // Continue to try next fallback endpoint
                continue;
              }
            } catch (fallbackError: any) {
              logger.error('Fallback endpoint error', { 
                fallbackEndpoint,
                error: fallbackError.message,
              });
              // Continue to try next fallback endpoint
              continue;
            }
          }

          // All fallback endpoints failed
          logger.error('All fallback endpoints failed');
        }
      }

      throw error;
    }
  }

  return {
    status: 'FAILED',
    error: 'Max attempts reached',
    model,
    endpoint,
  };
}

function handleGeminiError(status: number, errorText: string, endpoint?: string): never {
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
    logger.warn('Gemini API 503 - Service overloaded', { status, endpoint, errorText });
  } else if (status >= 500) {
    code = 'SERVER_ERROR';
    retryable = true;
  }

  throw new ProviderError(
    `Gemini API error (${status}) [${endpoint || 'unknown'}]: ${errorText}`,
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
