# Tests

测试脚本目录，按功能分类组织。

## 目录结构

```
tests/
├── api/           # API 接口测试
├── cache/         # 缓存功能测试
├── flow/          # 端到端流程测试
└── r2/            # R2 存储测试
```

## API 测试 (`api/`)

| 文件 | 描述 | 运行方式 |
|------|------|----------|
| `test-api.ts` | TypeScript API 测试，包含健康检查和手动测试指令 | `npm run test-api` |
| `test-all-api.js` | 基础 API 接口测试 (health, generate, jobs) | `node tests/api/test-all-api.js` |
| `test-complete-api.js` | 完整 API 测试，包括等待任务完成和取消任务 | `node tests/api/test-complete-api.js` |

## R2 存储测试 (`r2/`)

| 文件 | 描述 | 运行方式 |
|------|------|----------|
| `test-r2.mjs` | R2 基础配置测试 (连接、上传、下载) | `node tests/r2/test-r2.mjs` |
| `test-r2-connection.mjs` | R2 凭证验证测试 | `node tests/r2/test-r2-connection.mjs` |
| `test-r2-diagnostic.mjs` | R2 配置诊断测试 | `node tests/r2/test-r2-diagnostic.mjs` |
| `test-r2-final.mjs` | R2 凭证文档测试 | `node tests/r2/test-r2-final.mjs` |
| `test-r2-full.mjs` | R2 完整功能测试 (上传、下载、公共URL) | `node tests/r2/test-r2-full.mjs` |
| `test-public-url.mjs` | R2 公共 URL 访问测试 | `node tests/r2/test-public-url.mjs` |

## 端到端流程测试 (`flow/`)

| 文件 | 描述 | 运行方式 |
|------|------|----------|
| `test-complete-flow.mjs` | 完整图片生成流程测试 | `node tests/flow/test-complete-flow.mjs` |
| `test-final-complete.mjs` | 带自定义域名的完整流程测试 | `node tests/flow/test-final-complete.mjs` |
| `test-production-ready.mjs` | 生产环境就绪测试 | `node tests/flow/test-production-ready.mjs` |

## 缓存测试 (`cache/`)

| 文件 | 描述 | 运行方式 |
|------|------|----------|
| `test-cache.mjs` | 完整缓存功能测试（创建租户、API Key） | `node tests/cache/test-cache.mjs` |
| `test-cache-simple.mjs` | 简化缓存测试（使用现有 API Key） | `TEST_API_KEY=xxx node tests/cache/test-cache-simple.mjs` |

## 环境变量

测试脚本需要以下环境变量（在 `.env` 文件中配置）：

```bash
# API 配置
PORT=3001
TEST_API_KEY=img_test_dev_123456789

# R2 存储配置
STORAGE_TYPE=r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=gemini-images
R2_PUBLIC_BASE_URL=https://your-r2-domain.com
```

## 运行顺序建议

1. **首先测试 R2 连接**：`node tests/r2/test-r2-connection.mjs`
2. **测试 R2 完整功能**：`node tests/r2/test-r2-full.mjs`
3. **测试 API 接口**：`node tests/api/test-all-api.js`
4. **测试完整流程**：`node tests/flow/test-production-ready.mjs`
5. **测试缓存功能**：`node tests/cache/test-cache-simple.mjs`
