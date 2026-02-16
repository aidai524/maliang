/**
 * 即梦AI (Jimeng/Seedream) 类型定义
 * 
 * 基于火山引擎即梦AI-图片生成4.0接口
 * 文档: https://www.volcengine.com/docs/85621/1817045
 */

// 支持的宽高比
export type JimengAspectRatio = 
  | '1:1'   // 正方形 (默认)
  | '4:3'   // 横向 4:3
  | '3:4'   // 纵向 3:4
  | '16:9'  // 横向宽屏
  | '9:16'  // 纵向竖屏
  | '3:2'   // 横向 3:2
  | '2:3'   // 纵向 2:3
  | '21:9'  // 超宽屏
  | '9:21'; // 超竖屏

// 支持的分辨率
export type JimengResolution = '1K' | '2K' | '4K';

// 生成模式
export type JimengMode = 'text2img' | 'img2img';

// 生成模式
export type JimengGenerationMode = 'text_to_image' | 'image_to_image';

// 即梦生成参数
export interface JimengGenerateOptions {
  /** 火山方舟 API Key */
  apiKey: string;
  prompt: string;
  /** 主参考图 Base64 (兼容旧 API) */
  inputImage?: string;
  /** 多张参考图 Base64 数组 */
  referenceImages?: string[];
  /** 生成模式: text_to_image | image_to_image */
  generationMode?: JimengGenerationMode;
  /** 分辨率: 1K/2K/4K，默认 2K */
  resolution?: JimengResolution;
  /** 宽高比，默认 1:1 */
  aspectRatio?: JimengAspectRatio;
  /** 生成数量 1-15，默认 1 */
  sampleCount?: number;
  /** 是否添加水印，默认 false */
  watermark?: boolean;
  /** 模型版本 */
  modelVersion?: string;
}

// 提交任务返回结果
export interface JimengSubmitResult {
  taskId: string;
  model: string;
}

// 轮询结果状态
export type JimengTaskStatus = 
  | 'QUEUED'    // 排队中
  | 'RUNNING'   // 运行中
  | 'SUCCEEDED' // 成功
  | 'FAILED';   // 失败

// 生成的图片信息
export interface JimengImage {
  url: string;       // 图片URL (24小时有效)
  mimeType: string;
}

// 轮询结果
export interface JimengStatusResult {
  status: JimengTaskStatus;
  images?: JimengImage[];
  error?: string;
}

// 火山引擎 API 响应结构
export interface VolcResponse<T = any> {
  ResponseMetadata: {
    RequestId: string;
    Action: string;
    Version: string;
    Service: string;
    Region: string;
    Error?: {
      Code: string;
      Message: string;
    };
  };
  Result?: T;
}

// CVSync2AsyncSubmitTask 请求体
export interface CVSubmitTaskRequest {
  req_key: string;
  prompt: string;
  seed?: number;
  scale?: string;           // 宽高比
  image_resolution?: string; // 分辨率
  n?: number;               // 生成数量
  use_sr?: boolean;         // 超分辨率
  ddim_steps?: number;      // 采样步数
  logo_info?: {
    add_logo: boolean;
    position: number;
    language: number;
  };
  // 图生图参数
  binary_data_base64?: string[]; // 参考图Base64
  strength?: number;             // 参考强度 0-1
}

// CVSync2AsyncSubmitTask 响应
export interface CVSubmitTaskResponse {
  task_id: string;
  status?: string;
}

// CVGetResult 响应
export interface CVGetResultResponse {
  status: string;         // 'not_start' | 'running' | 'done' | 'failed'
  task_id: string;
  binary_data_base64?: string[];  // 生成的图片Base64
  image_urls?: string[];          // 生成的图片URL
  resp_data?: string;             // JSON字符串，包含更多信息
  err_code?: number;
  err_msg?: string;
}

// req_key 映射
export const JIMENG_REQ_KEYS = {
  // Seedream 4.0 文生图
  'seedream-4.0-t2i': 'seedream_4.0_t2i_global',
  // Seedream 4.0 图生图  
  'seedream-4.0-i2i': 'seedream_4.0_i2i_global',
  // Seedream 4.5 文生图
  'seedream-4.5-t2i': 'seedream_4.5_t2i_global',
  // Seedream 4.5 图生图
  'seedream-4.5-i2i': 'seedream_4.5_i2i_global',
} as const;

// 分辨率到尺寸映射 (1:1 基准)
export const RESOLUTION_SIZE_MAP: Record<JimengResolution, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
};

// 宽高比到比例映射
export const ASPECT_RATIO_MAP: Record<JimengAspectRatio, { width: number; height: number }> = {
  '1:1': { width: 1, height: 1 },
  '4:3': { width: 4, height: 3 },
  '3:4': { width: 3, height: 4 },
  '16:9': { width: 16, height: 9 },
  '9:16': { width: 9, height: 16 },
  '3:2': { width: 3, height: 2 },
  '2:3': { width: 2, height: 3 },
  '21:9': { width: 21, height: 9 },
  '9:21': { width: 9, height: 21 },
};
