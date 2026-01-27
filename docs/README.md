# API Documentation

本项目提供了完整的 API 文档，包括交互式测试功能。

## 📚 文档文件

| 文件 | 描述 |
|------|------|
| `api.html` | 交互式 API 测试页面（推荐使用） |
| `API.md` | Markdown 格式的完整 API 文档 |
| `openapi.yaml` | OpenAPI 3.0 规范文件 |

## 🚀 快速开始

### 方法 1：交互式测试（推荐）

直接在浏览器中打开 `api.html` 文件：

```bash
# 在浏览器中打开
open docs/api.html
# 或者
start docs/api.html  # Windows
# 或者直接双击文件
```

**功能特性:**
- ✅ 一键执行所有 API 请求
- ✅ 动态编辑请求参数
- ✅ 实时查看响应结果
- ✅ 内置请求/响应示例
- ✅ 状态码和错误信息展示
- ✅ 无需安装任何工具

### 方法 2：使用 curl 命令

查看 `API.md` 文件获取详细的 curl 命令示例：

```bash
cat docs/API.md
```

### 方法 3：使用 Swagger UI

如果你有 Swagger UI，可以导入 `openapi.yaml` 文件：

```bash
# 使用 Swagger UI 的 Docker 版本
docker run -p 8080:8080 -e SWAGGER_JSON=/openapi.yaml -v $(pwd)/openapi.yaml:/openapi.yaml swaggerapi/swagger-ui
```

然后访问 `http://localhost:8080`

## 📖 API 概览

### 端点列表

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/v1/images/generate` | 提交图片生成任务 |
| GET | `/v1/jobs` | 列出任务列表 |
| GET | `/v1/jobs/{jobId}` | 查询任务状态 |
| DELETE | `/v1/jobs/{jobId}` | 取消任务 |

### 认证方式

所有 API 端点（除 `/health` 外）都需要使用 Bearer Token 认证：

```
Authorization: Bearer YOUR_API_KEY
```

默认测试 API Key: `img_test_dev_123456789`

## 💡 使用示例

### 1. 提交图片生成任务

```bash
curl -X POST http://localhost:3001/v1/images/generate \
  -H "Authorization: Bearer img_test_dev_123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cute cat sitting on a couch",
    "mode": "draft"
  }'
```

### 2. 查询任务状态

```bash
curl http://localhost:3001/v1/jobs/JOB_ID \
  -H "Authorization: Bearer img_test_dev_123456789"
```

### 3. 列出所有任务

```bash
curl http://localhost:3001/v1/jobs \
  -H "Authorization: Bearer img_test_dev_123456789"
```

## 🔧 配置 API 服务器

确保 API 服务器正在运行：

```bash
# 启动服务器
npm run dev

# 服务器将在 http://localhost:3001 启动
```

## 📝 文档更新

如果 API 发生变化，请同步更新以下文件：

1. `openapi.yaml` - OpenAPI 规范
2. `api.html` - 交互式文档中的 API 规范定义
3. `API.md` - Markdown 文档

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进文档！

## 📧 联系方式

如有问题，请联系技术支持。
