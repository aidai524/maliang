/**
 * Gemini API Endpoint Configuration
 * 
 * Supports multiple API endpoints for the same Gemini models:
 * - official: Google's official Gemini API
 * - yunwu: Third-party Gemini proxy (云雾 API)
 * - (future): More third-party proxies can be added
 */

export type AuthType = 'url-key' | 'bearer';

export interface EndpointConfig {
  name: string;
  baseUrl: string;
  authType: AuthType;
  priority: number;
  // Optional: models that this endpoint is known to support well
  supportedModels?: string[];
  // Optional: models that should prefer this endpoint
  preferredModels?: string[];
}

/**
 * Gemini endpoint configurations
 * Keys must match the 'endpoint' field in ProviderKey table
 */
export const GEMINI_ENDPOINTS: Record<string, EndpointConfig> = {
  official: {
    name: 'Google Gemini Official',
    baseUrl: 'https://generativelanguage.googleapis.com',
    authType: 'url-key',
    priority: 1,
    supportedModels: [
      'gemini-2.0-flash-exp-image-generation',
      'gemini-2.5-flash-image-preview',
      'gemini-3-pro-image-preview',
    ],
  },
  yunwu: {
    name: 'Yunwu (Third-party Proxy)',
    baseUrl: 'https://yunwu.ai',
    authType: 'bearer',
    priority: 2,
    // 云雾只支持部分 Gemini 模型（不支持 gemini-2.0-flash-exp-image-generation）
    supportedModels: [
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-image-preview',
      'gemini-3-pro-image-preview',
    ],
    // 云雾对 gemini-3-pro-image-preview 支持更稳定
    preferredModels: ['gemini-3-pro-image-preview'],
  },
};

/**
 * Get endpoint configuration by name
 */
export function getEndpointConfig(endpoint: string): EndpointConfig | null {
  return GEMINI_ENDPOINTS[endpoint] || null;
}

/**
 * Get all available endpoints sorted by priority
 */
export function getEndpointsByPriority(): Array<{ endpoint: string; config: EndpointConfig }> {
  return Object.entries(GEMINI_ENDPOINTS)
    .map(([endpoint, config]) => ({ endpoint, config }))
    .sort((a, b) => a.config.priority - b.config.priority);
}

/**
 * Get the best endpoint for a specific model
 * Returns endpoints that support the model, with preferred endpoints first
 */
export function getEndpointsForModel(model: string): Array<{ endpoint: string; config: EndpointConfig }> {
  const endpoints = getEndpointsByPriority();
  
  // Filter endpoints that support this model
  const supporting = endpoints.filter(({ config }) => 
    !config.supportedModels || config.supportedModels.includes(model)
  );
  
  // Sort: preferred endpoints first, then by priority
  return supporting.sort((a, b) => {
    const aPreferred = a.config.preferredModels?.includes(model) ? 0 : 1;
    const bPreferred = b.config.preferredModels?.includes(model) ? 0 : 1;
    
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    return a.config.priority - b.config.priority;
  });
}

/**
 * Build the API URL based on endpoint configuration
 */
export function buildApiUrl(
  endpoint: string,
  model: string,
  apiKey: string
): { url: string; headers: Record<string, string> } {
  const config = getEndpointConfig(endpoint);
  
  if (!config) {
    throw new Error(`Unknown endpoint: ${endpoint}`);
  }
  
  const baseUrl = config.baseUrl;
  let url: string;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (config.authType === 'url-key') {
    // Official Gemini API style: key in URL
    url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  } else {
    // Bearer token style (yunwu and others)
    url = `${baseUrl}/v1beta/models/${model}:generateContent`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  
  return { url, headers };
}
