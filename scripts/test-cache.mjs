/**
 * 缓存功能测试脚本
 *
 * 测试内容：
 * 1. 发送第一个请求（应该调用 Gemini API）
 * 2. 发送相同的第二个请求（应该使用缓存）
 * 3. 验证缓存命中率和时间差异
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3001';
const TEST_PROMPT = 'a beautiful sunset over the ocean';
const TEST_MODE = 'final'; // final 模式会使用缓存

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 创建租户
 */
async function createTenant() {
  log('\n📝 步骤 1: 创建测试租户...', 'blue');

  const response = await fetch(`${API_BASE}/api/tenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Cache Test Tenant',
      webhookEnabled: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`创建租户失败: ${response.statusText}`);
  }

  const tenant = await response.json();
  log(`✅ 租户创建成功: ${tenant.id}`, 'green');
  return tenant;
}

/**
 * 创建 API Key
 */
async function createApiKey(tenantId) {
  log('\n🔑 步骤 2: 创建 API Key...', 'blue');

  const response = await fetch(`${API_BASE}/api/tenants/${tenantId}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`创建 API Key 失败: ${response.statusText}`);
  }

  const result = await response.json();
  log(`✅ API Key 创建成功: ${result.key.slice(0, 20)}...`, 'green');
  return result.key;
}

/**
 * 提交生成任务
 */
async function submitGeneration(apiKey, prompt, mode = 'final') {
  const response = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      mode,
      resolution: '1K',
      aspectRatio: '1:1',
      sampleCount: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`提交任务失败: ${response.statusText}`);
  }

  return response.json();
}

/**
 * 轮询任务状态
 */
async function pollJob(apiKey, jobId, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`查询任务失败: ${response.statusText}`);
    }

    const job = await response.json();

    if (job.status === 'SUCCEEDED' || job.status === 'FAILED') {
      return job;
    }

    // 等待 1 秒
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('任务超时');
}

/**
 * 获取缓存统计
 */
async function getCacheStats() {
  const response = await fetch(`${API_BASE}/api/admin/cache/stats`);

  if (!response.ok) {
    log(`⚠️  获取缓存统计失败: ${response.statusText}`, 'yellow');
    return null;
  }

  return response.json();
}

/**
 * 主测试流程
 */
async function main() {
  log('🚀 开始缓存功能测试...', 'blue');
  log('═'.repeat(60), 'blue');

  let tenant = null;
  let apiKey = null;

  try {
    // 步骤 1 & 2: 创建租户和 API Key
    tenant = await createTenant();
    apiKey = await createApiKey(tenant.id);

    // 等待服务准备好
    log('\n⏳ 等待服务准备...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 步骤 3: 第一次请求（应该调用 API）
    log('\n📸 步骤 3: 第一次图片生成请求（应该调用 Gemini API）...', 'blue');
    const startTime1 = Date.now();

    const job1 = await submitGeneration(apiKey, TEST_PROMPT, TEST_MODE);
    log(`✅ 任务提交成功: ${job1.id}`, 'green');

    log('⏳ 等待任务完成...', 'yellow');
    const result1 = await pollJob(apiKey, job1.id);

    const endTime1 = Date.now();
    const duration1 = endTime1 - startTime1;

    if (result1.status === 'SUCCEEDED') {
      log(`✅ 第一次任务完成`, 'green');
      log(`   用时: ${duration1 / 1000} 秒`, 'green');
      log(`   图片数量: ${result1.resultUrls?.length || 0}`, 'green');
    } else {
      log(`❌ 第一次任务失败: ${result1.error}`, 'red');
      return;
    }

    // 等待一下让缓存保存
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 步骤 4: 第二次请求（应该使用缓存）
    log('\n📸 步骤 4: 第二次图片生成请求（应该使用缓存）...', 'blue');
    const startTime2 = Date.now();

    const job2 = await submitGeneration(apiKey, TEST_PROMPT, TEST_MODE);
    log(`✅ 任务提交成功: ${job2.id}`, 'green');

    log('⏳ 等待任务完成...', 'yellow');
    const result2 = await pollJob(apiKey, job2.id);

    const endTime2 = Date.now();
    const duration2 = endTime2 - startTime2;

    if (result2.status === 'SUCCEEDED') {
      log(`✅ 第二次任务完成`, 'green');
      log(`   用时: ${duration2 / 1000} 秒`, 'green');
      log(`   图片数量: ${result2.resultUrls?.length || 0}`, 'green');
    } else {
      log(`❌ 第二次任务失败: ${result2.error}`, 'red');
      return;
    }

    // 步骤 5: 对比结果
    log('\n📊 步骤 5: 对比结果...', 'blue');
    log('═'.repeat(60), 'blue');

    const speedup = ((duration1 - duration2) / duration1 * 100).toFixed(1);

    log(`第一次请求（调用 API）: ${duration1 / 1000} 秒`, 'yellow');
    log(`第二次请求（使用缓存）: ${duration2 / 1000} 秒`, 'yellow');
    log(`速度提升: ${speedup}%`, 'green');

    // 验证图片 URL 是否相同
    const urls1 = result1.resultUrls || [];
    const urls2 = result2.resultUrls || [];
    const urlsMatch = JSON.stringify(urls1) === JSON.stringify(urls2);

    if (urlsMatch) {
      log(`✅ 缓存验证成功: 图片 URL 完全相同`, 'green');
    } else {
      log(`⚠️  警告: 图片 URL 不匹配`, 'yellow');
      log(`   第一次: ${JSON.stringify(urls1)}`, 'yellow');
      log(`   第二次: ${JSON.stringify(urls2)}`, 'yellow');
    }

    // 步骤 6: 获取缓存统计
    log('\n📈 步骤 6: 缓存统计...', 'blue');
    const stats = await getCacheStats();

    if (stats) {
      log(`缓存条目总数: ${stats.totalEntries || 0}`, 'yellow');
      log(`缓存命中次数: ${stats.hitCount || 0}`, 'green');
      log(`缓存未命中: ${stats.missCount || 0}`, 'yellow');
      log(`命中率: ${stats.hitRate || '0%'}`, 'green');
    }

    // 最终结论
    log('\n🎉 测试完成!', 'green');
    log('═'.repeat(60), 'blue');

    if (urlsMatch && duration2 < duration1) {
      log('✅ 缓存功能工作正常!', 'green');
      log(`   - 第二次请求使用了缓存结果`, 'green');
      log(`   - 响应时间减少了 ${speedup}%`, 'green');
      log(`   - 图片内容完全一致`, 'green');
    } else if (!urlsMatch) {
      log('⚠️  缓存可能未生效（图片 URL 不同）', 'yellow');
      log('   可能原因:', 'yellow');
      log('   - Draft 模式不使用缓存', 'yellow');
      log('   - 缓存 TTL 过期', 'yellow');
      log('   - Redis 连接问题', 'yellow');
    } else {
      log('⚠️  缓存效果不明显', 'yellow');
    }

  } catch (error) {
    log(`\n❌ 测试失败: ${error.message}`, 'red');
    console.error(error);
  } finally {
    // 清理：删除测试租户
    if (tenant) {
      try {
        log('\n🧹 清理测试数据...', 'blue');
        await fetch(`${API_BASE}/api/tenants/${tenant.id}`, {
          method: 'DELETE',
        });
        log('✅ 清理完成', 'green');
      } catch (error) {
        log(`⚠️  清理失败: ${error.message}`, 'yellow');
      }
    }
  }
}

// 运行测试
main().catch(error => {
  log(`\n💥 未处理的错误: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
