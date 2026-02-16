/**
 * 即梦AI 端点配置
 * 
 * 火山方舟大模型服务平台 - OpenAI 兼容 API
 */

export interface JimengEndpoint {
  name: string;
  baseUrl: string;
  model: string;
  authType: 'bearer';
}

export const JIMENG_ENDPOINTS: Record<string, JimengEndpoint> = {
  // 火山方舟官方端点
  ark: {
    name: 'Volcengine Ark (Official)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seedream-4-0-250828',
    authType: 'bearer',
  },
};

export const DEFAULT_ENDPOINT = 'ark';

/**
 * 获取端点配置
 */
export function getEndpointConfig(endpoint: string = DEFAULT_ENDPOINT): JimengEndpoint {
  const config = JIMENG_ENDPOINTS[endpoint];
  if (!config) {
    throw new Error(`Unknown Jimeng endpoint: ${endpoint}`);
  }
  return config;
}
