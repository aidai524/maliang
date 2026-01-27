可以。我按你要的目标（**异步出图 + 回调/轮询 + key pool + 分布式限流 + 可横向扩到 500/min**）把需求拆成一套“AI 编程友好”的多步实现清单：从最小可用（MVP）一路升级到可规模化（Scale）。你可以直接把每一步丢给 Claude Code / Cursor 逐步实现。

---

## 阶段 0：基线与约束

**目标：**定义你对外 SLA 与内部限制，避免后面返工

* [ ] 定义 Job 生命周期：`QUEUED/RUNNING/SUCCEEDED/FAILED/RETRYING/CANCELED`
* [ ] 定义错误分类：可重试（429/5xx/timeout） vs 不可重试（4xx参数/内容拒绝）
* [ ] 定义配额模型：`tenant plan -> rpm, daily cap, max_concurrency`
* [ ] 定义计费点：提交即扣费 vs 成功扣费（建议：提交预扣，失败退回或不计）

产出：`docs/contract.md`（API/状态/错误码/计费）

---

## 阶段 1：MVP 异步生图（先跑通闭环）

**目标：**用户能提交任务 → 后台生成 → 轮询拿结果（先不做回调）
**服务：API + Worker + DB + 对象存储**

### 1.1 数据模型

* [ ] `jobs` 表（见下方建议字段）
* [ ] `job_events` 表（用于审计与排障，可选但推荐）

`jobs`字段建议：

* `job_id, tenant_id, status, prompt, inputs_ref, attempts, max_attempts, created_at, updated_at`
* `key_id, provider_request_id, error_code, error_message`
* `result_urls (json array), metadata (json)`

### 1.2 API

* [ ] `POST /v1/images:generate` → 返回 `{job_id, status:"QUEUED"}`
* [ ] `GET /v1/jobs/{job_id}` → 返回 job 状态 + result_urls
* [ ] `GET /v1/jobs?tenant_id=&status=&cursor=` → 管理/控制台用

### 1.3 队列与 Worker

* [ ] Redis/SQS 队列：`generate_queue`
* [ ] Worker 消费：取 job → 调 nano banana API → 存图到 S3/R2 → 更新 job

### 1.4 最小限流（先简单）

* [ ] 全局并发上限（worker 内部 semaphore）
* [ ] 每租户并发上限（内存 map 也行，后面再换分布式）

产出：能稳定跑 100/min 的最小系统。

---

## 阶段 2：可靠性（重试/幂等/熔断）

**目标：**失败可恢复、重复提交不重复扣费、不因异常卡死

### 2.1 幂等（强烈建议立刻做）

* [ ] `POST /generate` 支持 `Idempotency-Key` header
* [ ] DB 里记录 `(tenant_id, idempotency_key) -> job_id`
* [ ] 相同 key 重复请求直接返回同一 job

### 2.2 智能重试

* [ ] 仅对 429/5xx/timeout 重试
* [ ] 指数退避 + 抖动：2–5s / 8–15s / 30–60s / 2–5min
* [ ] `attempts` 达上限标记 FAILED

### 2.3 Key 级熔断（即使现在只有 1–2 个 key 也要做）

* [ ] 每个 key 维护 `consecutive_failures`
* [ ] 连续 N 次（如 5）→ `cooldown_until = now + 10min`
* [ ] 冷却期间不派单

---

## 阶段 3：Key Pool + 分布式限流（从“能跑”到“能扩”）

**目标：**多 key 分摊流量、扩 worker 不失控、为 500/min 铺路

### 3.1 Key Registry

* [ ] `api_keys` 表：`key_id, provider, encrypted_key, rpm_limit, concurrency_limit, enabled`
* [ ] runtime 状态（Redis）：`in_flight, rpm_used_60s, cooldown_until, error_rate`

### 3.2 分布式限流（Redis）

实现三层 token bucket / sliding window：

* [ ] 全局 limiter：`global:rpm` + `global:concurrency`
* [ ] key limiter：`key:{id}:rpm` + `key:{id}:concurrency`
* [ ] tenant limiter：`tenant:{id}:rpm` + `tenant:{id}:concurrency`

所有 worker 在调用供应商前必须：

* [ ] `acquire_tokens()` 成功才执行
* [ ] 失败则延迟重入队（不要硬打）

### 3.3 调度策略（合规扩容的关键）

* [ ] 过滤：未冷却、in_flight < limit、rpm < limit
* [ ] 排序：least in_flight / 最低延迟 / 最低错误率
* [ ] 选 key → 原子性占用 in_flight（Redis INCR）→ 调用 → 结束 DECR

---

## 阶段 4：Webhook 回调（B2B 必备）

**目标：**客户不轮询也能拿结果；回调失败可重试、可追踪

### 4.1 Webhook 配置

* [ ] `tenants`表存：`webhook_url, webhook_secret, webhook_enabled`
* [ ] 支持 per-tenant 配置回调事件：`job.succeeded/job.failed`

### 4.2 Webhook Queue

* [ ] 生成成功/失败 → 写入 `webhook_queue`
* [ ] webhook worker 发送 POST：

  * payload: `{event_id, job_id, tenant_id, status, result_urls, timestamp}`
  * header: `X-Signature: hmac_sha256(body, webhook_secret)`

### 4.3 Webhook 重试 & DLQ

* [ ] 失败重试指数退避（最多 8 次）
* [ ] 超过次数进 DLQ
* [ ] 提供 `POST /v1/webhooks/replay?job_id=` 管理端补发

---

## 阶段 5：面向 500/min 的扩展（不重构，补“伸缩与隔离”）

**目标：**线性横向扩容 + 降低重请求比例

### 5.1 自动伸缩

* [ ] 指标：队列 backlog、p95 latency、429 rate、error rate
* [ ] HPA/AutoScaling：按 backlog 增加 worker 副本

### 5.2 Dispatcher（可选但强烈推荐）

* [ ] 把“选 key + 拿 token”集中到 dispatcher
* [ ] worker 只执行任务
  好处：调度一致、扩容更稳。

### 5.3 两阶段生成（Draft/Final）

* [ ] `mode=draft|final`
* [ ] draft 成功后再触发 final（或由客户确认触发）
* [ ] 大幅降低超时与失败带来的浪费，提升整体吞吐

---

## 阶段 6：运营与成本（上线后你一定会需要）

* [ ] 管理后台：key 健康度、错误率、p95、花费、租户用量
* [ ] 成本保护：每租户日预算上限、异常流量自动降级到 draft
* [ ] 审计日志：谁生成了什么、何时、用哪个 key（排障必备）

---

## 你可以直接让 AI 编程的“任务拆分方式”

建议你把每个阶段拆成独立 PR：

1. PR-1：Job API + DB + Queue + Worker（轮询）
2. PR-2：幂等 + 重试 + 错误分类
3. PR-3：Key Pool + Redis 分布式限流
4. PR-4：Webhook + 重试 + DLQ
5. PR-5：自动伸缩指标 +（可选）Dispatcher
6. PR-6：Draft/Final 两阶段 + 成本控制
下面给你一套 **Node.js + TypeScript** 的“可直接喂给 AI 编程”的工程模板：**异步出图 + 轮询 + webhook + Key Pool + 分布式限流 + 可横向扩到 500/min**。
我用的是 **BullMQ + Redis**（最省心、扩容顺滑），存储用 **R2/S3** 都兼容。

---

## 目录结构（建议直接照抄）

```
image-saas/
  package.json
  tsconfig.json
  .env.example

  src/
    server.ts
    app.ts

    config/
      env.ts

    db/
      prisma.ts
      schema.prisma
      migrations/...

    queue/
      redis.ts
      bull.ts
      queues.ts
      workers/
        generate.worker.ts
        webhook.worker.ts

    providers/
      nanobanana/
        client.ts
        types.ts
        normalize.ts

    services/
      job.service.ts
      keypool.service.ts
      limiter.service.ts
      storage.service.ts
      webhook.service.ts

    api/
      routes.ts
      middleware/
        auth.ts
        idempotency.ts
        rateLimitTenant.ts
      controllers/
        generate.controller.ts
        jobs.controller.ts
        webhookIn.controller.ts
        admin.controller.ts

    utils/
      crypto.ts
      sleep.ts
      logger.ts
      errors.ts
      zod.ts

  scripts/
    dev.ts
```

---

## 关键环境变量（.env.example）

```bash
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://...

REDIS_URL=redis://localhost:6379

# 对象存储（二选一/都支持）
S3_ENDPOINT=https://...
S3_REGION=auto
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=images
S3_PUBLIC_BASE_URL=https://cdn.yourdomain.com/

# 你的“对外回调”签名密钥（每租户也会有自己的 secret）
WEBHOOK_SIGNING_SECRET=...

# Provider keys（建议放 DB/密钥管理，不要只放 env）
NANOBANANA_API_BASE=https://...
```

---

## DB Schema（Prisma 示例，核心表）

> 你可以直接用 Prisma + Postgres。下面是最小可用字段，后面再加统计字段也行。

`src/db/schema.prisma`

```prisma
model Tenant {
  id             String  @id @default(cuid())
  name           String
  apiKeyHash     String  // 用于鉴权
  planRpm        Int     @default(60)
  planConcurrency Int    @default(5)

  webhookUrl     String?
  webhookSecret  String?
  webhookEnabled Boolean @default(false)

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  jobs           Job[]
}

model ProviderKey {
  id              String  @id @default(cuid())
  provider         String  // "nanobanana"
  encryptedKey     String
  rpmLimit         Int     @default(60)
  concurrencyLimit Int     @default(2)
  enabled          Boolean @default(true)

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Job {
  id              String @id @default(cuid())
  tenantId        String
  tenant          Tenant @relation(fields: [tenantId], references: [id])

  idempotencyKey  String?
  status          String  @default("QUEUED") // QUEUED/RUNNING/SUCCEEDED/FAILED/RETRYING/CANCELED
  mode            String  @default("final")  // draft/final

  prompt          String
  inputImageUrl   String? // 参考图（若有）
  resultUrls      Json?
  errorCode       String?
  errorMessage    String?

  attempts        Int     @default(0)
  maxAttempts     Int     @default(4)

  provider        String  @default("nanobanana")
  providerKeyId   String?
  providerRequestId String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([tenantId, status])
  @@unique([tenantId, idempotencyKey])
}
```

---

## API 设计（对外）

* `POST /v1/images:generate` → `{ jobId, status }`
* `GET /v1/jobs/:jobId` → `{ status, resultUrls?, error? }`
* `POST /v1/provider/webhook/nanobanana` → 接收供应商回调（可选）
* `POST /v1/admin/keys` / `GET /v1/admin/keys` → 管 key（内部用）

---

## BullMQ 队列定义

`src/queue/queues.ts`

```ts
export const QUEUE_GENERATE = "generate_queue";
export const QUEUE_WEBHOOK = "webhook_queue";
```

`src/queue/bull.ts`

```ts
import { Queue } from "bullmq";
import { connection } from "./redis";
import { QUEUE_GENERATE, QUEUE_WEBHOOK } from "./queues";

export const generateQueue = new Queue(QUEUE_GENERATE, { connection });
export const webhookQueue  = new Queue(QUEUE_WEBHOOK,  { connection });
```

---

## 分布式限流（Redis Token Bucket，三层）

`src/services/limiter.service.ts`

```ts
import { redis } from "../queue/redis";

type AcquireArgs = { key: string; limit: number; windowSec: number };

export async function acquireWindow({ key, limit, windowSec }: AcquireArgs) {
  // 简化版 sliding window：用 INCR + EXPIRE
  const nowKey = `${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const count = await redis.incr(nowKey);
  if (count === 1) await redis.expire(nowKey, windowSec);
  return count <= limit;
}

// 并发令牌（in_flight）
export async function tryAcquireConcurrency(key: string, limit: number) {
  const v = await redis.incr(key);
  if (v === 1) await redis.expire(key, 3600); // 防止泄漏，worker 正常会 release
  if (v > limit) {
    await redis.decr(key);
    return false;
  }
  return true;
}
export async function releaseConcurrency(key: string) {
  await redis.decr(key);
}
```

> 生产版你可以换成更精确的 Lua token bucket / sliding log，但这个起步版就能把系统稳住。

---

## Key Pool（挑 key + 熔断/冷却）

`src/services/keypool.service.ts`

```ts
import { prisma } from "../db/prisma";
import { redis } from "../queue/redis";

type PickedKey = { id: string; provider: string; secret: string; rpm: number; conc: number };

const RUNTIME = (id: string) => ({
  inflight: `kp:${id}:inflight`,
  cooldown: `kp:${id}:cooldown_until`,
  rpmKey:   `kp:${id}:rpm` // 配合 limiter
});

export async function pickProviderKey(provider: string): Promise<PickedKey | null> {
  const keys = await prisma.providerKey.findMany({ where: { provider, enabled: true } });
  if (!keys.length) return null;

  // 过滤掉冷却中的 key
  const now = Date.now();
  const candidates: { k: any; inflight: number }[] = [];
  for (const k of keys) {
    const cooldown = Number(await redis.get(RUNTIME(k.id).cooldown) || "0");
    if (cooldown > now) continue;
    const inflight = Number(await redis.get(RUNTIME(k.id).inflight) || "0");
    candidates.push({ k, inflight });
  }
  if (!candidates.length) return null;

  // least inflight
  candidates.sort((a,b)=>a.inflight-b.inflight);
  const chosen = candidates[0].k;

  // 解密 key（这里先占位，你应该接 KMS/SealedSecrets）
  const secret = chosen.encryptedKey; // TODO: decrypt
  return { id: chosen.id, provider: chosen.provider, secret, rpm: chosen.rpmLimit, conc: chosen.concurrencyLimit };
}

export async function markKeyFailure(keyId: string, consecutive: number) {
  if (consecutive >= 5) {
    // 冷却 10 分钟
    await redis.set(RUNTIME(keyId).cooldown, String(Date.now() + 10 * 60_000), "PX", 10 * 60_000);
  }
}
```

---

## 生成 Worker（核心：拿 token → 选 key → 调 provider → 存图 → 更新 job → 触发 webhook）

`src/queue/workers/generate.worker.ts`

```ts
import { Worker } from "bullmq";
import { connection } from "../redis";
import { QUEUE_GENERATE } from "../queues";
import { prisma } from "../../db/prisma";
import { pickProviderKey, markKeyFailure } from "../../services/keypool.service";
import { acquireWindow, tryAcquireConcurrency, releaseConcurrency } from "../../services/limiter.service";
import { nanoGenerate } from "../../providers/nanobanana/client";
import { putImage } from "../../services/storage.service";
import { webhookQueue } from "../bull";

const GLOBAL_RPM = 1000; // 你自己的总上限（按供应商配额调整）
const GLOBAL_CONC = 200; // 目标并发（按实际耗时调）
const provider = "nanobanana";

export const generateWorker = new Worker(
  QUEUE_GENERATE,
  async (job) => {
    const { jobId } = job.data as { jobId: string };

    const dbJob = await prisma.job.findUnique({ where: { id: jobId } });
    if (!dbJob || dbJob.status === "CANCELED") return;

    // ——全局限流——
    const okGlobal = await acquireWindow({ key: "lim:global:rpm", limit: GLOBAL_RPM, windowSec: 60 });
    if (!okGlobal) throw new Error("GLOBAL_RATE_LIMIT");

    const okConc = await tryAcquireConcurrency("lim:global:inflight", GLOBAL_CONC);
    if (!okConc) throw new Error("GLOBAL_CONC_LIMIT");

    let keyConcToken: string | null = null;
    try {
      // ——选 key——
      const k = await pickProviderKey(provider);
      if (!k) throw new Error("NO_PROVIDER_KEY_AVAILABLE");

      // ——key 级限流——
      const okKeyRpm = await acquireWindow({ key: `lim:key:${k.id}:rpm`, limit: k.rpm, windowSec: 60 });
      if (!okKeyRpm) throw new Error("KEY_RATE_LIMIT");

      keyConcToken = `lim:key:${k.id}:inflight`;
      const okKeyConc = await tryAcquireConcurrency(keyConcToken, k.conc);
      if (!okKeyConc) throw new Error("KEY_CONC_LIMIT");

      // ——tenant 级限流（可选 MVP 也能加）——
      const tenant = await prisma.tenant.findUnique({ where: { id: dbJob.tenantId } });
      if (tenant) {
        const okTenantRpm = await acquireWindow({ key: `lim:tenant:${tenant.id}:rpm`, limit: tenant.planRpm, windowSec: 60 });
        if (!okTenantRpm) throw new Error("TENANT_RATE_LIMIT");
      }

      await prisma.job.update({
        where: { id: dbJob.id },
        data: { status: "RUNNING", providerKeyId: k.id }
      });

      // ——调用 provider（这里先假设同步返回；如果 provider 支持回调，可改成 submit+poll）——
      const res = await nanoGenerate({
        apiKey: k.secret,
        prompt: dbJob.prompt,
        inputImageUrl: dbJob.inputImageUrl ?? undefined,
        mode: dbJob.mode as any,
      });

      // ——存图——
      const urls: string[] = [];
      for (const img of res.images) {
        const url = await putImage(img.bytes, { contentType: img.contentType });
        urls.push(url);
      }

      await prisma.job.update({
        where: { id: dbJob.id },
        data: { status: "SUCCEEDED", resultUrls: urls, errorCode: null, errorMessage: null }
      });

      // ——触发对外 webhook（异步）——
      if (tenant?.webhookEnabled && tenant.webhookUrl) {
        await webhookQueue.add("send", { tenantId: tenant.id, jobId: dbJob.id }, { attempts: 8, backoff: { type: "exponential", delay: 2000 } });
      }
    } catch (e: any) {
      const msg = String(e?.message || e);

      // 可重试错误判断（你可做更细）
      const retryable = ["GLOBAL_RATE_LIMIT","GLOBAL_CONC_LIMIT","KEY_RATE_LIMIT","KEY_CONC_LIMIT","TENANT_RATE_LIMIT"].includes(msg)
        || /429|502|503|504|timeout/i.test(msg);

      const nextAttempts = (dbJob.attempts ?? 0) + 1;

      await prisma.job.update({
        where: { id: dbJob.id },
        data: {
          status: retryable && nextAttempts < dbJob.maxAttempts ? "RETRYING" : "FAILED",
          attempts: nextAttempts,
          errorCode: msg,
          errorMessage: msg
        }
      });

      // 熔断计数（示意：你可以在 redis 里做 per-key consecutive_failures）
      if (dbJob.providerKeyId) await markKeyFailure(dbJob.providerKeyId, 5);

      if (retryable && nextAttempts < dbJob.maxAttempts) throw e; // 让 BullMQ 重试
    } finally {
      if (keyConcToken) await releaseConcurrency(keyConcToken);
      await releaseConcurrency("lim:global:inflight");
    }
  },
  { connection, concurrency: 50 } // 这里是单 worker 进程并发，靠水平扩展拉满
);
```

---

## Webhook Worker（你推送给客户）

`src/queue/workers/webhook.worker.ts`

```ts
import { Worker } from "bullmq";
import { connection } from "../redis";
import { QUEUE_WEBHOOK } from "../queues";
import { prisma } from "../../db/prisma";
import { signHmacSha256 } from "../../utils/crypto";
import fetch from "node-fetch";

export const webhookWorker = new Worker(
  QUEUE_WEBHOOK,
  async (job) => {
    const { tenantId, jobId } = job.data as { tenantId: string; jobId: string };

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const dbJob  = await prisma.job.findUnique({ where: { id: jobId } });

    if (!tenant?.webhookEnabled || !tenant.webhookUrl || !tenant.webhookSecret || !dbJob) return;

    const payload = {
      eventId: job.id,
      jobId: dbJob.id,
      status: dbJob.status,
      resultUrls: dbJob.resultUrls ?? [],
      error: dbJob.status === "FAILED" ? { code: dbJob.errorCode, message: dbJob.errorMessage } : null,
      timestamp: Date.now(),
    };

    const body = JSON.stringify(payload);
    const sig = signHmacSha256(body, tenant.webhookSecret);

    const resp = await fetch(tenant.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": sig,
      },
      body,
    });

    if (!resp.ok) throw new Error(`WEBHOOK_FAILED_${resp.status}`);
  },
  { connection, concurrency: 50 }
);
```

---

## Provider client（先做同步版；异步能力用“你自己异步化”兜住）

**重要说明（实话）**：很多生图 API“看起来同步”，但你做 SaaS 时**不需要它原生异步**——你这套队列架构天然把它异步化了：

* 用户请求立即返回 jobId
* worker 后台慢慢跑
* 完成后你回调/客户轮询

所以“供应商是否原生 async”不是硬门槛。

`src/providers/nanobanana/client.ts`

```ts
export async function nanoGenerate(args: {
  apiKey: string;
  prompt: string;
  inputImageUrl?: string;
  mode?: "draft" | "final";
}): Promise<{ images: { bytes: Buffer; contentType: string }[] }> {
  // TODO: 按 nano banana 实际 API 填写
  // 这里写成“同步返回图片 bytes”的抽象接口
  // 如果供应商是返回 imageUrl，也可以直接返回 url 列表再去下载或转存。
  throw new Error("IMPLEMENT_PROVIDER_CALL");
}
```

---

## API Controller：提交任务（含幂等）

`src/api/controllers/generate.controller.ts`

```ts
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { generateQueue } from "../../queue/bull";

const Body = z.object({
  prompt: z.string().min(1),
  inputImageUrl: z.string().url().optional(),
  mode: z.enum(["draft","final"]).optional(),
});

export async function generate(req: any, res: any) {
  const tenant = req.tenant; // auth middleware 填
  const idem = req.headers["idempotency-key"] as string | undefined;

  const body = Body.parse(req.body);

  // 幂等：同 tenant + idempotencyKey 只生成一个 job
  if (idem) {
    const existing = await prisma.job.findUnique({ where: { tenantId_idempotencyKey: { tenantId: tenant.id, idempotencyKey: idem } } as any });
    if (existing) return res.status(202).json({ jobId: existing.id, status: existing.status });
  }

  const jobRow = await prisma.job.create({
    data: {
      tenantId: tenant.id,
      idempotencyKey: idem,
      prompt: body.prompt,
      inputImageUrl: body.inputImageUrl,
      mode: body.mode ?? "final",
      status: "QUEUED",
      maxAttempts: 4,
    }
  });

  await generateQueue.add("generate", { jobId: jobRow.id }, {
    attempts: 4,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
  });

  return res.status(202).json({ jobId: jobRow.id, status: "QUEUED" });
}
```

---

## 轮询接口：查询 job

`src/api/controllers/jobs.controller.ts`

```ts
import { prisma } from "../../db/prisma";

export async function getJob(req: any, res: any) {
  const tenant = req.tenant;
  const { jobId } = req.params;

  const job = await prisma.job.findFirst({ where: { id: jobId, tenantId: tenant.id } });
  if (!job) return res.status(404).json({ error: "NOT_FOUND" });

  return res.json({
    jobId: job.id,
    status: job.status,
    resultUrls: job.status === "SUCCEEDED" ? (job.resultUrls ?? []) : [],
    error: job.status === "FAILED" ? { code: job.errorCode, message: job.errorMessage } : null,
    updatedAt: job.updatedAt,
  });
}
```

---

## 你现在就能按“多步”让 AI 编程干活（推荐顺序）

按 PR 拆（每一步都可独立验收）：

1. **PR-1**：Express API + Prisma Job 表 + BullMQ 队列 + 轮询接口（先跑通闭环）
2. **PR-2**：幂等 + 重试 + 错误分类（让失败可控）
3. **PR-3**：Redis 分布式限流（三层）+ Key Pool（为扩容铺路）
4. **PR-4**：Webhook 推送队列 + 签名 + DLQ（B2B必备）
5. **PR-5**：Draft/Final 两阶段 + 成本保护（上 500/min 时非常关键）

---

## 关于你问的“nano banana API 是否支持异步”

就工程落地来说：**你完全不需要依赖它“原生异步”**，因为你这套系统已经把它异步化（队列 + job 状态 + webhook/轮询）。
如果它**有**“submit 返回 request_id + 查询状态/回调”那是加分项（能减少长连接超时、提升成功率），但不是必须条件——我们在 `providers/nanobanana/client.ts` 里可以很容易把“同步调用”替换成“submit+poll”实现。

---

如果你现在告诉我两件事，我可以把 `providers/nanobanana/client.ts` 这块也写成可直接用的版本（按你实际接入方式）：

1. 你现在调用 nano banana 的 API 是什么形式：**同步直接回图** 还是 **先回 URL** 还是 **回 request_id**？
2. 你打算用 **Cloudflare R2** 还是 **AWS S3**（我给你对应 `storage.service.ts` 完整实现）。

---

行，那我把你要的 **A/B/C/D 全部一次性给齐**：

* ✅ Redis Lua 精准限流（全局 / key / tenant / 并发）
* ✅ API Key 鉴权中间件（Tenant API key）
* ✅ Webhook 签名规范 + 发送与校验代码
* ✅ docker-compose（Postgres + Redis）+ 本地跑通步骤
* ✅ OpenAPI.yaml（最小可用版）

全部都是“可直接喂给 AI 编程”的模块级代码，你按文件落地即可。

---

# 0) 依赖（package.json 里你会用到）

```bash
npm i express zod bullmq ioredis prisma @prisma/client
npm i @aws-sdk/client-s3 node-fetch
npm i dotenv
npm i -D typescript ts-node-dev @types/express @types/node
```

---

# 1) Docker 本地跑通（Redis + Postgres）

`docker-compose.yml`

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: imagesaas
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7
    command: ["redis-server", "--appendonly", "yes"]
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

本地启动：

```bash
docker compose up -d
npx prisma migrate dev
npm run dev
```

---

# 2) Redis 连接（ioredis）

`src/queue/redis.ts`

```ts
import IORedis from "ioredis";

export const redis = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const connection = redis; // BullMQ 直接复用
```

---

# 3) API Key 鉴权模块（Tenant）

思路：每个 Tenant 有一个 `apiKeyHash`（建议存 SHA-256），请求头带 `Authorization: Bearer <key>` 或 `X-Api-Key`.

## 3.1 crypto 工具

`src/utils/crypto.ts`

```ts
import crypto from "crypto";

export function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export function hmacSha256Hex(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function timingSafeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
```

## 3.2 auth middleware

`src/api/middleware/auth.ts`

```ts
import { prisma } from "../../db/prisma";
import { sha256Hex, timingSafeEqualHex } from "../../utils/crypto";

function extractApiKey(req: any): string | null {
  const h = (req.headers["authorization"] || "").toString();
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const x = req.headers["x-api-key"];
  if (x) return x.toString().trim();
  return null;
}

export async function authTenant(req: any, res: any, next: any) {
  const apiKey = extractApiKey(req);
  if (!apiKey) return res.status(401).json({ error: "UNAUTHORIZED" });

  const hash = sha256Hex(apiKey);

  // 注意：为了不泄漏信息，统一报 UNAUTHORIZED
  const tenant = await prisma.tenant.findFirst({ where: { apiKeyHash: hash } });
  if (!tenant) return res.status(401).json({ error: "UNAUTHORIZED" });

  // 如果你想更严谨：可以把原始 key 也做一次 timing-safe compare（这里hash等值即可）
  if (!timingSafeEqualHex(tenant.apiKeyHash, hash)) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }

  req.tenant = tenant;
  next();
}
```

---

# 4) Redis Lua 精准限流（推荐：滑动窗口 + 并发）

你需要两个能力：

* **RPM 限流**（窗口 60s）：全局、tenant、key
* **并发限流**（in_flight）：全局、tenant、key

这里给你 **Lua 版本**（原子性强、扩容稳定）。

## 4.1 RPM（滑动窗口计数：近 windowSec 内请求数）

`src/services/limiter.lua.ts`（把脚本字符串放 TS 里方便加载）

```ts
export const LUA_SLIDING_WINDOW = `
-- KEYS[1] = zset key
-- ARGV[1] = now_ms
-- ARGV[2] = window_ms
-- ARGV[3] = limit
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- 删除窗口外
redis.call("ZREMRANGEBYSCORE", key, 0, now - window)

local count = redis.call("ZCARD", key)
if count >= limit then
  -- 返回 0 + 当前count
  return {0, count}
end

-- 记录一次请求（member 用 now+随机避免冲突）
local member = tostring(now) .. "-" .. tostring(math.random(1, 1000000000))
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, window + 1000)

count = count + 1
return {1, count}
`;
`;

export const LUA_CONCURRENCY = `
-- KEYS[1] = inflight key
-- ARGV[1] = limit
-- ARGV[2] = ttl_ms
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])

local v = redis.call("INCR", key)
if v == 1 then
  redis.call("PEXPIRE", key, ttl)
end
if v > limit then
  redis.call("DECR", key)
  return {0, v}
end
return {1, v}
`;

export const LUA_CONCURRENCY_RELEASE = `
-- KEYS[1] = inflight key
local key = KEYS[1]
local v = redis.call("DECR", key)
if v < 0 then
  redis.call("SET", key, 0)
  return 0
end
return v
`;
`;
```

## 4.2 limiter service（执行 Lua）

`src/services/limiter.service.ts`

```ts
import { redis } from "../queue/redis";
import { LUA_SLIDING_WINDOW, LUA_CONCURRENCY, LUA_CONCURRENCY_RELEASE } from "./limiter.lua";

let shaSliding: string | null = null;
let shaConc: string | null = null;
let shaConcRel: string | null = null;

async function ensureLoaded() {
  if (!shaSliding) shaSliding = await redis.script("LOAD", LUA_SLIDING_WINDOW);
  if (!shaConc) shaConc = await redis.script("LOAD", LUA_CONCURRENCY);
  if (!shaConcRel) shaConcRel = await redis.script("LOAD", LUA_CONCURRENCY_RELEASE);
}

export async function acquireRpm(key: string, limit: number, windowSec = 60) {
  await ensureLoaded();
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const [ok, count] = (await redis.evalsha(shaSliding!, 1, key, now, windowMs, limit)) as [number, number];
  return { ok: ok === 1, count };
}

export async function acquireConcurrency(key: string, limit: number, ttlSec = 3600) {
  await ensureLoaded();
  const ttlMs = ttlSec * 1000;
  const [ok, v] = (await redis.evalsha(shaConc!, 1, key, limit, ttlMs)) as [number, number];
  return { ok: ok === 1, value: v };
}

export async function releaseConcurrency(key: string) {
  await ensureLoaded();
  await redis.evalsha(shaConcRel!, 1, key);
}
```

---

# 5) Webhook（对外规范 + 发送 + 客户端校验）

你作为 SaaS，要“可被 B2B 安全接入”，最关键是：**签名、重放保护、幂等**。

## 5.1 你的 webhook payload 规范

建议固定字段：

* `eventId`：唯一事件 id（可用 Bull job.id）
* `jobId`：你系统的 job id
* `tenantId`
* `status`: `SUCCEEDED|FAILED`
* `resultUrls`: string[]
* `error`: {code,message} | null
* `timestamp`: ms

签名：

* header：`X-Signature: sha256=<hex>`
* 计算：`HMAC_SHA256(rawBody, tenant.webhookSecret)`

重放保护（推荐）：

* 客户端校验 `timestamp` 在 5 分钟内
* 客户端记录 `eventId` 去重

## 5.2 SaaS 侧发送（worker 里用）

`src/services/webhook.service.ts`

```ts
import fetch from "node-fetch";
import { hmacSha256Hex } from "../utils/crypto";

export async function sendWebhook(args: {
  url: string;
  secret: string;
  payload: any;
}) {
  const body = JSON.stringify(args.payload);
  const sig = `sha256=${hmacSha256Hex(body, args.secret)}`;

  const resp = await fetch(args.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": sig,
    },
    body,
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`WEBHOOK_HTTP_${resp.status} ${t}`);
  }
}
```

## 5.3 客户端（你的第三方用户）如何校验签名（示例）

你可以把下面这段直接写进你的对接文档给客户：

```ts
import crypto from "crypto";

function verifyWebhook(rawBody: string, signatureHeader: string, secret: string) {
  // signatureHeader: "sha256=<hex>"
  const [, sigHex] = signatureHeader.split("=", 2);
  const mac = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sigHex, "hex"), Buffer.from(mac, "hex"));
}
```

> 注意：校验要用 **rawBody**（未被 JSON parse 的原始字符串），Express 要配 `verify` 拿原文。

## 5.4 你服务端接收“供应商 webhook”（如果 nano banana 提供）

同理做签名校验（如果供应商给签名），并将状态写回 job。

---

# 6) Express：拿到 raw body（Webhook 必备）

`src/app.ts`（关键片段）

```ts
import express from "express";
import routes from "./api/routes";

export const app = express();

// 用于 webhook 原始 body 校验
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));

app.use(routes);
```

---

# 7) OpenAPI 最小版（直接给第三方接入）

`openapi.yaml`

```yaml
openapi: 3.0.3
info:
  title: Image SaaS API
  version: 0.1.0
servers:
  - url: https://api.yourdomain.com
paths:
  /v1/images:generate:
    post:
      summary: Submit async image generation job
      security:
        - ApiKeyAuth: []
      parameters:
        - in: header
          name: Idempotency-Key
          schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [prompt]
              properties:
                prompt: { type: string }
                inputImageUrl: { type: string, format: uri }
                mode: { type: string, enum: [draft, final], default: final }
      responses:
        "202":
          description: Accepted
          content:
            application/json:
              schema:
                type: object
                properties:
                  jobId: { type: string }
                  status: { type: string }
  /v1/jobs/{jobId}:
    get:
      summary: Get job status (polling)
      security:
        - ApiKeyAuth: []
      parameters:
        - in: path
          name: jobId
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Job
          content:
            application/json:
              schema:
                type: object
                properties:
                  jobId: { type: string }
                  status: { type: string }
                  resultUrls:
                    type: array
                    items: { type: string }
                  error:
                    nullable: true
                    type: object
                    properties:
                      code: { type: string }
                      message: { type: string }
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Authorization
```

---

# 8) “三层限流”在 generate.worker 里怎么接（最终形态）

你在 worker 里调用供应商前，按这个顺序拿 token：

```ts
// 1) global rpm + global conc
await acquireRpm("lim:global:rpm", GLOBAL_RPM, 60);
await acquireConcurrency("lim:global:conc", GLOBAL_CONC, 3600);

// 2) tenant rpm + tenant conc
await acquireRpm(`lim:tenant:${tenantId}:rpm`, tenant.planRpm, 60);
await acquireConcurrency(`lim:tenant:${tenantId}:conc`, tenant.planConcurrency, 3600);

// 3) key rpm + key conc
await acquireRpm(`lim:key:${keyId}:rpm`, keyRpm, 60);
await acquireConcurrency(`lim:key:${keyId}:conc`, keyConc, 3600);
```

失败（ok=false）就：

* 不要硬打 API
* 把 Bull job 抛错交给 backoff 重试（或你自己延迟 requeue）

结束务必释放并发：

```ts
await releaseConcurrency(`lim:key:${keyId}:conc`);
await releaseConcurrency(`lim:tenant:${tenantId}:conc`);
await releaseConcurrency("lim:global:conc");
```

---

# 9) Cloudflare R2（你已选）——补充注意点

你要能拿到公网 URL，需要：

* 要么通过 `S3_PUBLIC_BASE_URL` 指向你自己的 CDN 域名（R2 + 自己域名/Worker 转发）
* 要么对象桶公开（不建议 B2B，建议 CDN/签名 URL）

你现在先用 `S3_PUBLIC_BASE_URL=https://cdn.yourdomain.com` 就行，后续再补签名 URL。

---

## 你现在可以按这个顺序让 AI 编程落地（最稳）

1. **跑通本地**：docker-compose + prisma + API（generate/poll）
2. 接 **nano banana submit+poll**（你已经有）
3. 接 **R2 上传**
4. 加 **Lua 限流（三层）** + key pool
5. 加 **Webhook 推送队列 + 签名**
6. 压测到 100/min，再扩到 500/min（横向扩 worker）

---

如果你愿意，我还可以把“完整可运行的 starter repo”再进一步拆成 **每个 PR 的 Claude Code 提示词**（比如 PR-1/2/3/4 每个一步到位生成文件），你直接复制粘贴给 AI 就能一口气生成整套工程。你要我按 PR-1 开始给吗？

