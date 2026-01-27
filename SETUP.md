# Image SaaS API

异步图片生成服务，基于 Gemini/Nano Banana API，支持分布式限流、Key Pool、Webhook 回调。

## 功能特性

- ✅ 异步任务提交 + 轮询查询
- ✅ 幂等性支持（防止重复提交）
- ✅ 三层分布式限流（全局 / Tenant / Key）
- ✅ API Key Pool 管理（自动负载均衡 + 熔断）
- ✅ Webhook 回调通知
- ✅ Draft/Final 两种生成模式
- ✅ Cloudflare R2 对象存储
- ✅ Prisma ORM + PostgreSQL
- ✅ BullMQ + Redis 队列

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入必要的配置：

```bash
# Gemini API Keys (至少配置一个)
GEMINI_API_KEY_1=your_first_api_key
GEMINI_API_KEY_2=your_second_api_key

# 测试用的固定 API Key（可选，方便开发）
# 设置后，npm run init 会使用这个 key 而不是随机生成
TEST_API_KEY=img_test_dev_123456789

# Cloudflare R2 (可选，不配置则图片无法存储)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=images
R2_PUBLIC_BASE_URL=https://your-cdn-domain.com/
```

### 3. 启动 Docker 容器

```bash
docker compose up -d
```

### 4. 初始化数据库

```bash
# 生成 Prisma Client
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev

# 创建测试数据（Tenant + Provider Keys）
npm run init
```

`npm run init` 会创建测试数据。如果在 `.env` 中设置了 `TEST_API_KEY`，则会使用该 key；否则会生成一个随机 key 并显示出来。

### 查看已有的 API Key

```bash
npm run show-keys
```

这会显示所有租户的信息（注意：API Key 在数据库中是 hash 存储的，无法反向获取明文，所以请妥善保存 `TEST_API_KEY`）

### 5. 启动服务

```bash
npm run dev
```

服务将在 `http://localhost:3000` 启动。

## API 使用

### 提交生成任务

```bash
curl -X POST http://localhost:3000/v1/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A photorealistic cat sitting on a couch",
    "mode": "draft"
  }'
```

响应：

```json
{
  "jobId": "clx1234567890",
  "status": "QUEUED"
}
```

### 查询任务状态

```bash
curl http://localhost:3000/v1/jobs/clx1234567890 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

响应：

```json
{
  "jobId": "clx1234567890",
  "status": "SUCCEEDED",
  "resultUrls": ["https://cdn.example.com/images/abc123.png"],
  "error": null,
  "createdAt": "2025-01-25T10:00:00.000Z",
  "updatedAt": "2025-01-25T10:00:05.000Z"
}
```

### 列出所有任务

```bash
curl http://localhost:3000/v1/jobs \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## 管理命令

```bash
# 初始化测试数据
npm run init

# 重置数据库（删除所有数据）
npm run reset yes

# 查看已有的 API Keys（显示 tenant 信息）
npm run show-keys

# 创建新 Tenant
npm run create-tenant "My Company" 100 10

# 添加 Provider Key
npm run add-provider-key gemini your_api_key_here 60 2

# 测试 API
npm run test-api
```

### 关于 API Key

- **开发环境**：在 `.env` 中设置 `TEST_API_KEY=img_test_xxx`，运行 `npm run init` 后直接使用该 key
- **生产环境**：API Key 是 hash 存储的，无法反向获取明文。创建 tenant 时请妥善保存生成的 key
- **忘记 key 了？**：如果忘记了自己设置的 `TEST_API_KEY`，重新运行 `npm run reset yes && npm run init` 即可

## 数据库管理

```bash
# 打开 Prisma Studio（可视化管理）
npm run prisma:studio

# 手动创建迁移
npx prisma migrate dev --name add_new_field

# 重置数据库
npx prisma migrate reset
```

## 项目结构

```
src/
├── server.ts           # 入口文件
├── app.ts              # Express 应用
├── config/
│   └── env.ts          # 环境变量配置
├── db/
│   ├── schema.prisma   # 数据库模型
│   └── prisma.ts       # Prisma 客户端
├── queue/
│   ├── redis.ts        # Redis 连接
│   ├── queues.ts       # 队列定义
│   ├── bull.ts         # BullMQ 队列
│   └── workers/        # 后台 Worker
├── services/           # 业务逻辑
├── providers/          # Gemini API 客户端
├── api/                # API 路由和控制器
└── utils/              # 工具函数
```

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/v1/images/generate` | POST | 提交生成任务 |
| `/v1/jobs/:jobId` | GET | 查询任务状态 |
| `/v1/jobs` | GET | 列出任务列表 |
| `/v1/jobs/:jobId` | DELETE | 取消任务 |

## 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | - |
| `REDIS_URL` | Redis 连接字符串 | `redis://localhost:6379` |
| `GEMINI_API_KEY_1` | Gemini API Key 1 | - |
| `GEMINI_API_KEY_2` | Gemini API Key 2 | - |
| `TEST_API_KEY` | 测试用的固定 API Key（可选） | - |
| `GLOBAL_RPM_LIMIT` | 全局 RPM 限制 | `1000` |
| `GLOBAL_CONCURRENCY_LIMIT` | 全局并发限制 | `200` |
| `WORKER_CONCURRENCY` | Worker 并发数 | `50` |

## 故障排查

### Redis 连接失败

```bash
# 检查 Docker 容器状态
docker ps

# 查看 Redis 日志
docker logs image_saas_redis
```

### 数据库连接失败

```bash
# 检查 PostgreSQL 状态
docker ps

# 查看 Postgres 日志
docker logs image_saas_postgres
```

### Prisma 相关问题

```bash
# 重新生成 Prisma Client
npx prisma generate

# 重置数据库
npx prisma migrate reset
```

## 开发

```bash
# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 生产运行
npm run start
```

## License

MIT
