# Gemini 3.1 Flash Image Preview 部署指南
## 概述
本次更新添加了以下新功能：
- Gemini 3.1 Flash Image Preview 模型支持
- 动态模型选择功能
- Web Search Grounding 支持
- 0.5K 分辨率选项
- 阿里云 OSS 存储支持

## 数据库更新
⚠️ **重要**: 此次更新包含数据库结构变更
- 新增 `model` 字段 - 指定使用的模型
- 新增 `enableWebSearch` 字段 - Web Search Grounding 开关

## 部署步骤
### 1. 拉取最新代码
```bash
git pull origin main
```

### 2. 更新数据库结构 ⚠️
```bash
# 开发环境 - 重置数据库
npx prisma migrate reset

# 生产环境 - 创建迁移
npx prisma migrate dev --name add_gemini_31_support

# 如果迁移失败，# 手动创建新迁移
npx prisma migrate dev --name add_model_and_websearch --create-only
```

### 3. 重新生成 Prisma Client
```bash
npx prisma generate
```

### 4. 重启服务
```bash
# 开发环境
npm run dev

# 生产环境
pm2 restart all
```

## 模型更新
### 新增参数
| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `model` | string | 指定使用的模型 | 环境变量 `GEMINI_MODEL` |
| `enableWebSearch` | boolean | 启用 Web Search Grounding | `false` |

### 可用模型
- `gemini-2.0-flash-exp-image-generation`
- `gemini-2.5-flash-image-preview`
- `gemini-3-pro-image-preview` (默认)
- `gemini-3.1-flash-image-preview` (最新)
- `doubao-seedream-4-0-250828` (即梦 AI)

- 更多第三方代理模型...

### 分辨率选项 (Gemini 3.1+)
- 0.5K: $0.03/image
- 1K: $0.067/image (默认)
- 2K: $0.09/image
- 4K: $0.151/image

## API 示例
### 默认模型
```bash
curl -X POST http://localhost:3001/v1/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cute orange cat"
  }'
```

### 指定 Gemini 3.1 模型
```bash
curl -X POST http://localhost:3001/v1/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cute orange cat wearing a tiny hat",
    "model": "gemini-3.1-flash-image-preview",
    "resolution": "4K",
    "enableWebSearch": true
  }'
```

## Web Search Grounding
启用 Web Search Grounding 后，模型会：
1. 搜索网络上的相关图片和文本信息
2. 整合搜索结果到生成过程
3. 生成更具上下文相关性的图像

**示例：**
```json
{
  "prompt": "A modern smartphone design based on 2024 trends",
  "enableWebSearch": true
}
```

## OSS 存储配置
在 `.env` 文件中设置：
```bash
# 切换到 OSS 存储
STORAGE_TYPE=oss

# OSS 配置
OSS_REGION=oss-cn-hangzhou
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_KEY_ID=your_key
OSS_ACCESS_KEY_SECRET=your_secret
OSS_BUCKET_NAME=your_bucket
OSS_PUBLIC_BASE_URL=https://your-bucket.oss-cn-hangzhou.aliyuncs.com
```

## 环境变量更新
### 必需更新
```bash
# 默认模型（可选）
GEMINI_MODEL=gemini-3.1-flash-image-preview
```

### 可选更新
```bash
# Web Search Grounding（默认关闭）
ENABLE_WEB_SEARCH_BY-default=false

# 存储类型（R2 或 oss）
STORAGE_TYPE=r2  # 或 oss
```

## 测试
### 测试 OSS 连接
```bash
npx ts-node scripts/test-oss.ts
```

### 测试 Gemini 3.1
```bash
npx ts-node scripts/test-gemini-3.1.ts
```

## 回滚方案
如果部署后发现问题，```bash
# 1. 回滚代码
git revert HEAD~1

git reset --hard HEAD~1

# 2. 回滚数据库迁移
npx prisma migrate rollback

# 3. 重启服务
pm2 restart all
```

## 向后兼容性
- ✅ 所有新参数均为可选
- ✅ 不指定模型时使用环境变量默认值
- ✅ 现有 API 调用无需修改
- ✅ 数据库结构向后兼容
- ✅ 旧版本客户端无需更新
- ✅ OSS/R2 存储可平滑切换
- ✅ 模型选择完全动态
- ✅ 价格透明（用户无感知）
- ✅ 错误处理兼容
- ✅ Webhook 格式不变
- ✅ 响应格式保持一致
- ✅ 不指定参数时行为与之前完全相同
- ✅ 数据库迁移可安全回滚

