/**
 * Types for Gemini/Nano Banana API integration
 */

export type GeminiMode = 'draft' | 'final';

export type GeminiResolution = '1K' | '2K' | '4K';

export type GeminiAspectRatios = 'Auto' | '1:1' | '9:16' | '16:9' | '3:4' | '4:3' | '3:2' | '2:3' | '5:4' | '4:5' | '21:9';

export type GeminiEndpoint = 'official' | 'yunwu' | string;

export type GeminiGenerateOptions = {
  apiKey: string;
  prompt: string;
  inputImageUrl?: string;
  mode?: GeminiMode;
  resolution?: GeminiResolution;
  aspectRatio?: GeminiAspectRatios;
  sampleCount?: number;
  model?: string;
  endpoint?: GeminiEndpoint;
};

export type GeminiSubmitResult = {
  requestId: string;
  model: string;
  endpoint: string;
};

export type GeminiStatusResult =
  | { status: 'PENDING' | 'RUNNING' | 'SUCCEEDED'; images: Array<{ url: string; mimeType: string }> }
  | { status: 'FAILED'; error: string };

export type GenerationConfig = {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  // Enable image output from Gemini
  responseModalities?: ('TEXT' | 'IMAGE')[];
  // Image generation configuration
  imageConfig?: {
    imageSize?: '1K' | '2K' | '4K';
    aspectRatio?: string;
    numberOfImages?: number;
  };
};

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type GeminiContent = {
  role?: string;
  parts: GeminiPart[];
};

export type GeminiGenerateContentRequest = {
  contents: GeminiContent[];
  generationConfig?: GenerationConfig;
};

export type GeminiGenerateContentResponse = {
  candidates: Array<{
    content: {
      parts: GeminiPart[];
    };
    finishReason: string;
    metadata?: {
      images?: Array<{
        data: string;
        mimeType: string;
      }>;
    };
  }>;
  name?: string;
};

export type GeminiErrorResponse = {
  error: {
    code: number;
    message: string;
    status: string;
  };
};
