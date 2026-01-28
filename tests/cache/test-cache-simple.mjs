/**
 * 缓存功能测试脚本（简化版）
 *
 * 使用方法：
 * 1. 确保数据库中有一个测试租户和 API Key
 * 2. 设置环境变量 TEST_API_KEY
 * 3. 运行脚本: node scripts/test-cache-simple.mjs
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3001';
const TEST_API_KEY = process.env.TEST_API_KEY || 'test-key-placeholder';
const TEST_PROMPT = 'a beautiful sunset over the ocean';
const TEST_MODE = 'final'; // final 模式会使用缓存

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * 提交生成任务
 */
async function submitGeneration(apiKey, prompt, mode = 'final') {
  const response = await fetch(`${API_BASE}/v1/images/generate`, {
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
    const errorText = await response.text();
    throw new Error(`提交任务失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // 支持 jobId 和 id 两种字段名
  return {
    id: data.jobId || data.id,
    status: data.status,
  };
}

/**
 * 轮询任务状态
 */
async function pollJob(apiKey, jobId, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      throw new Error(`查询任务失败: ${response.statusText}`);
    }

    const job = await response.json();

    if (job.status === 'SUCCEEDED' || job.status === 'FAILED') {
      return job;
    }

    // 每 5 次打印一次进度
    if (i % 5 === 0) {
      log(`   进度: ${i}/${maxAttempts} - 状态: ${job.status}`, 'cyan');
    }

    // 等待 1 秒
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('任务超时');
}

/**
 * 主测试流程
 */
async function main() {
  log('🚀 缓存功能测试', 'blue');
  log('═'.repeat(60), 'blue');

  // 检查 API Key
  if (!process.env.TEST_API_KEY || process.env.TEST_API_KEY === 'test-key-placeholder') {
    log('\n⚠️  警告: 未设置 TEST_API_KEY 环境变量', 'yellow');
    log('\n请先创建一个测试 API Key:', 'yellow');
    log('\n1. 连接到数据库:', 'cyan');
    log('   docker exec -it maliang-postgres-1 psql -U postgres -d maliang', 'cyan');
    log('\n2. 查找或创建租户:', 'cyan');
    log('   SELECT id FROM "Tenant" LIMIT 1;', 'cyan');
    log('\n3. 创建 API Key:', 'cyan');
    log('   INSERT INTO "ProviderKey" (id, provider, "encryptedKey", "rpmLimit", "concurrencyLimit", enabled)', 'cyan');
    log('   VALUES (gen_random_uuid(), \'gemini\', \'your-api-key-here\', 60, 2, true);', 'cyan');
    log('\n4. 设置环境变量并运行:', 'cyan');
    log('   export TEST_API_KEY=<your-api-key>', 'cyan');
    log('   node scripts/test-cache-simple.mjs', 'cyan');
    log('\n或者使用以下命令快速测试（如果有现有的 ProviderKey）:', 'yellow');
    return;
  }

  log(`\n🔑 使用 API Key: ${TEST_API_KEY.slice(0, 20)}...`, 'yellow');

  try {
    // 等待服务准备好
    log('\n⏳ 检查服务状态...', 'yellow');
    const healthResponse = await fetch(`${API_BASE}/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      log(`✅ 服务正常运行: ${health.status}`, 'green');
    } else {
      log('⚠️  服务可能未正常运行', 'yellow');
    }

    // 第一次请求（应该调用 API）
    log('\n📸 第一次请求（应该调用 Gemini API）...', 'blue');
    log('─'.repeat(60), 'blue');
    const startTime1 = Date.now();

    const job1 = await submitGeneration(TEST_API_KEY, TEST_PROMPT, TEST_MODE);
    log(`✅ 任务提交成功: ${job1.id}`, 'green');
    log(`   初始状态: ${job1.status}`, 'cyan');
    log(`   提交时间: ${new Date().toLocaleTimeString()}`, 'cyan');

    log('⏳ 等待任务完成...', 'yellow');
    const result1 = await pollJob(TEST_API_KEY, job1.id);

    const endTime1 = Date.now();
    const duration1 = endTime1 - startTime1;

    if (result1.status === 'SUCCEEDED') {
      log(`✅ 第一次任务完成`, 'green');
      log(`   完成时间: ${duration1 / 1000} 秒`, 'green');
      log(`   图片数量: ${result1.resultUrls?.length || 0}`, 'green');
      if (result1.resultUrls?.length > 0) {
        log(`   第一张图片: ${result1.resultUrls[0].slice(0, 60)}...`, 'cyan');
      }
    } else {
      log(`❌ 第一次任务失败: ${result1.error || '未知错误'}`, 'red');
      return;
    }

    // 等待一下让缓存保存
    log('\n⏳ 等待缓存保存...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 第二次请求（应该使用缓存）
    log('\n📸 第二次请求（应该使用缓存）...', 'blue');
    log('─'.repeat(60), 'blue');
    const startTime2 = Date.now();

    const job2 = await submitGeneration(TEST_API_KEY, TEST_PROMPT, TEST_MODE);
    log(`✅ 任务提交成功: ${job2.id}`, 'green');
    log(`   初始状态: ${job2.status}`, 'cyan');
    log(`   提交时间: ${new Date().toLocaleTimeString()}`, 'cyan');

    log('⏳ 等待任务完成...', 'yellow');
    const result2 = await pollJob(TEST_API_KEY, job2.id);

    const endTime2 = Date.now();
    const duration2 = endTime2 - startTime2;

    if (result2.status === 'SUCCEEDED') {
      log(`✅ 第二次任务完成`, 'green');
      log(`   完成时间: ${duration2 / 1000} 秒`, 'green');
      log(`   图片数量: ${result2.resultUrls?.length || 0}`, 'green');
      if (result2.resultUrls?.length > 0) {
        log(`   第一张图片: ${result2.resultUrls[0].slice(0, 60)}...`, 'cyan');
      }
    } else {
      log(`❌ 第二次任务失败: ${result2.error || '未知错误'}`, 'red');
      return;
    }

    // 对比结果
    log('\n📊 对比结果', 'blue');
    log('═'.repeat(60), 'blue');

    const speedup = duration1 > 0 ? ((duration1 - duration2) / duration1 * 100).toFixed(1) : 0;

    log(`第一次请求（调用 API）:   ${duration1 / 1000} 秒`, 'yellow');
    log(`第二次请求（使用缓存）:   ${duration2 / 1000} 秒`, 'yellow');

    if (duration2 < duration1) {
      log(`⚡ 速度提升: ${speedup}%`, 'green');
    } else {
      log(`⚠️  第二次请求未明显加快`, 'yellow');
    }

    // 验证图片 URL 是否相同
    const urls1 = result1.resultUrls || [];
    const urls2 = result2.resultUrls || [];
    const urlsMatch = JSON.stringify(urls1) === JSON.stringify(urls2);

    if (urlsMatch) {
      log(`✅ 缓存验证: 图片 URL 完全相同`, 'green');
    } else {
      log(`⚠️  警告: 图片 URL 不匹配`, 'yellow');
      if (urls1.length > 0 && urls2.length > 0) {
        log(`   第一次: ${urls1[0].slice(0, 80)}...`, 'yellow');
        log(`   第二次: ${urls2[0].slice(0, 80)}...`, 'yellow');
      }
    }

    // 最终结论
    log('\n🎉 测试总结', 'blue');
    log('═'.repeat(60), 'blue');

    if (urlsMatch) {
      log('✅ 缓存功能正常工作!', 'green');
      log(`   ✓ 第二次请求返回了相同的图片`, 'green');
      if (duration2 < duration1) {
        log(`   ✓ 响应时间减少了 ${speedup}%`, 'green');
      }
    } else {
      log('⚠️  缓存可能未生效', 'yellow');
      log('   可能原因:', 'yellow');
      log('   - 两次请求的参数不完全相同', 'yellow');
      log('   - Draft 模式不使用缓存（当前为 final 模式）', 'yellow');
      log('   - 缓存 TTL 过期（24小时）', 'yellow');
      log('   - Redis 连接问题', 'yellow');
    }

  } catch (error) {
    log(`\n❌ 测试失败: ${error.message}`, 'red');
    if (error.message.includes('401') || error.message.includes('403')) {
      log('\n⚠️  认证失败，请检查 API Key 是否正确', 'yellow');
      log('   设置环境变量: export TEST_API_KEY=<your-key>', 'yellow');
    } else if (error.message.includes('ECONNREFUSED')) {
      log('\n⚠️  无法连接到服务，请确保服务正在运行', 'yellow');
      log('   启动服务: npm run dev', 'yellow');
    }
    console.error(error);
  }
}

// 运行测试
main().catch(error => {
  log(`\n💥 未处理的错误: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
