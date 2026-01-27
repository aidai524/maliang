# Image SaaS API Documentation

## Overview

Image SaaS API 提供异步图片生成服务，基于 Gemini/Nano Banana 模型。

**Base URL:** `http://localhost:3001` (开发环境)

**认证方式:** Bearer Token

---

## Quick Start

```bash
# 1. 设置环境变量
export API_BASE="http://localhost:3001"
export API_KEY="img_test_dev_123456789"

# 2. 提交生成任务
curl -X POST ${API_BASE}/v1/images/generate \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cute cat sitting on a couch",
    "mode": "draft"
  }'

# 3. 查询任务状态
curl ${API_BASE}/v1/jobs/JOB_ID \
  -H "Authorization: Bearer ${API_KEY}"
```

---

## API Endpoints

### 1. Health Check

检查 API 服务是否正常运行。

**Endpoint:** `GET /health`

**认证:** 不需要

**请求示例:**

```bash
curl http://localhost:3001/health
```

**响应示例:**

```json
{
  "status": "ok",
  "timestamp": "2026-01-26T10:00:00.000Z"
}
```

---

### 2. Submit Image Generation

提交一个新的图片生成任务。

**Endpoint:** `POST /v1/images/generate`

**认证:** 需要 (Bearer Token)

**Headers:**
- `Authorization: Bearer YOUR_API_KEY` (必须)
- `Idempotency-Key: client-request-id-12345` (可选，用于幂等性)

**请求体:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 图片生成的文本描述 |
| `mode` | string | 否 | 生成模式：`draft`(快速/低质量) 或 `final`(高质量)，默认 `final` |
| `inputImageUrl` | string | 否 | 参考图片 URL (用于 img2img) |

**请求示例:**

```bash
curl -X POST http://localhost:3001/v1/images/generate \
  -H "Authorization: Bearer img_test_dev_123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A photorealistic cat sitting on a couch",
    "mode": "draft"
  }'
```

**响应示例:**

```json
{
  "jobId": "cmkuz35wf00034rk15ycgzvce",
  "status": "QUEUED"
}
```

**状态码:**
- `202 Accepted` - 任务已提交并排队
- `400 Bad Request` - 请求参数无效
- `401 Unauthorized` - API Key 无效
- `429 Too Many Requests` - 超出速率限制

---

### 3. List Jobs

列出当前租户的所有任务，支持过滤和分页。

**Endpoint:** `GET /v1/jobs`

**认证:** 需要 (Bearer Token)

**Query 参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | string | 过滤状态：`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `RETRYING`, `CANCELED` |
| `limit` | integer | 每页数量 (1-100)，默认 50 |
| `cursor` | string | 分页游标，从上一页响应获取 |

**请求示例:**

```bash
# 列出所有任务
curl http://localhost:3001/v1/jobs \
  -H "Authorization: Bearer img_test_dev_123456789"

# 只列出成功的任务
curl "http://localhost:3001/v1/jobs?status=SUCCEEDED&limit=10" \
  -H "Authorization: Bearer img_test_dev_123456789"
```

**响应示例:**

```json
{
  "items": [
    {
      "id": "cmkuz35wf00034rk15ycgzvce",
      "status": "SUCCEEDED",
      "prompt": "A cute cat sitting on a couch",
      "mode": "draft",
      "resultUrls": [
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
      ],
      "errorCode": null,
      "errorMessage": null,
      "createdAt": "2026-01-26T09:36:16.288Z",
      "updatedAt": "2026-01-26T09:36:25.123Z"
    }
  ],
  "hasMore": false
}
```

**状态码:**
- `200 OK` - 成功获取列表

---

### 4. Get Job Status

获取特定任务的详细状态和结果。

**Endpoint:** `GET /v1/jobs/{jobId}`

**认证:** 需要 (Bearer Token)

**Path 参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `jobId` | string | 任务 ID |

**请求示例:**

```bash
curl http://localhost:3001/v1/jobs/cmkuz35wf00034rk15ycgzvce \
  -H "Authorization: Bearer img_test_dev_123456789"
```

**响应示例:**

```json
{
  "jobId": "cmkuz35wf00034rk15ycgzvce",
  "status": "SUCCEEDED",
  "resultUrls": [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  ],
  "error": null,
  "createdAt": "2026-01-26T09:36:16.288Z",
  "updatedAt": "2026-01-26T09:36:25.123Z"
}
```

**任务状态:**
- `QUEUED` - 任务已排队
- `RUNNING` - 任务正在处理
- `SUCCEEDED` - 任务成功完成
- `FAILED` - 任务失败
- `RETRYING` - 任务正在重试
- `CANCELED` - 任务已取消

**状态码:**
- `200 OK` - 成功获取任务详情
- `401 Unauthorized` - API Key 无效
- `404 Not Found` - 任务不存在

---

### 5. Cancel Job

取消一个任务。只有 `QUEUED` 或 `RETRYING` 状态的任务可以被取消。

**Endpoint:** `DELETE /v1/jobs/{jobId}`

**认证:** 需要 (Bearer Token)

**Path 参数:**

| 参数 | 类型 | 说明 |
|------|------|------|
| `jobId` | string | 任务 ID |

**请求示例:**

```bash
curl -X DELETE http://localhost:3001/v1/jobs/cmkuz35wf00034rk15ycgzvce \
  -H "Authorization: Bearer img_test_dev_123456789"
```

**响应示例:**

```json
{
  "jobId": "cmkuz35wf00034rk15ycgzvce",
  "status": "CANCELED"
}
```

**状态码:**
- `200 OK` - 任务已取消
- `400 Bad Request` - 任务状态不允许取消
- `401 Unauthorized` - API Key 无效
- `404 Not Found` - 任务不存在

---

## Common Error Responses

所有错误响应都遵循以下格式：

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message"
}
```

**常见错误码:**

| 错误码 | 说明 | HTTP 状态 |
|--------|------|-----------|
| `INVALID_REQUEST` | 请求参数无效 | 400 |
| `INVALID_API_KEY` | API Key 无效 | 401 |
| `RATE_LIMIT_EXCEEDED` | 超出速率限制 | 429 |
| `JOB_NOT_FOUND` | 任务不存在 | 404 |
| `INVALID_STATE` | 任务状态不允许该操作 | 400 |
| `UNKNOWN_ERROR` | 未知错误 | 500 |

---

## Rate Limits

每个租户的速率限制配置：

| 指标 | 默认值 |
|------|--------|
| 每分钟请求数 (RPM) | 60 |
| 最大并发数 | 5 |

超过限制会返回 `429 Too Many Requests` 错误。

---

## Idempotency

为了防止重复提交，可以使用 `Idempotency-Key` header：

```bash
curl -X POST http://localhost:3001/v1/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Idempotency-Key: unique-request-id-12345" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A cat"}'
```

使用相同的 `Idempotency-Key` 重复请求会返回相同的任务 ID。

---

## Webhook Notification (Optional)

如果租户配置了 Webhook URL，任务完成时会自动发送通知。

**Webhook Payload:**

```json
{
  "eventId": "evt_1234567890",
  "jobId": "cmkuz35wf00034rk15ycgzvce",
  "tenantId": "cmktx999f0000ssga7o497182",
  "status": "SUCCEEDED",
  "resultUrls": [
    "https://cdn.example.com/image1.png"
  ],
  "error": null,
  "timestamp": 1737893785000
}
```

---

## Interactive API Testing

打开 `docs/api.html` 文件可以在浏览器中交互式测试所有 API 接口。

**功能:**
- 🎯 一键执行 API 请求
- 📝 动态编辑请求参数
- 📊 实时查看响应结果
- 📋 内置请求/响应示例

使用浏览器打开 `docs/api.html` 开始测试。

---

## Support

如需帮助，请查看项目文档或联系技术支持。
