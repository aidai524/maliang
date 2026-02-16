#!/usr/bin/env node
/**
 * 测试即梦AI (Jimeng/Seedream 4.0) 图片生成
 * 
 * Usage: node tests/api/test-jimeng.mjs
 */

import 'dotenv/config';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const API_KEY = process.env.TEST_API_KEY || 'img_test_dev_123456789';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testJimengGenerate() {
  console.log('🚀 测试即梦AI (Seedream 4.0) 图片生成\n');
  console.log(`API Base: ${API_BASE}`);
  console.log(`API Key: ${API_KEY.substring(0, 20)}...`);
  console.log('');

  // 1. 提交生成任务
  console.log('1️⃣ 提交生成任务...');
  
  const generateResponse = await fetch(`${API_BASE}/v1/images/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      prompt: '一只可爱的熊猫宝宝坐在竹林中，手里拿着竹子，周围有蝴蝶飞舞，阳光透过竹叶洒下，超高清，细节丰富，8K',
      provider: 'jimeng',
      resolution: '2K',
      aspectRatio: '1:1',
      sampleCount: 1,
    }),
  });

  if (!generateResponse.ok) {
    const error = await generateResponse.text();
    console.error('❌ 提交失败:', generateResponse.status, error);
    process.exit(1);
  }

  const generateData = await generateResponse.json();
  console.log('✅ 任务已提交:', generateData);
  console.log('');

  const jobId = generateData.jobId;

  // 2. 轮询任务状态
  console.log('2️⃣ 轮询任务状态...');
  
  let attempts = 0;
  const maxAttempts = 120; // 最多等待 4 分钟
  
  while (attempts < maxAttempts) {
    await sleep(2000);
    attempts++;

    const statusResponse = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });

    if (!statusResponse.ok) {
      console.error('❌ 查询状态失败:', statusResponse.status);
      continue;
    }

    const statusData = await statusResponse.json();
    
    if (statusData.status === 'SUCCEEDED') {
      console.log('');
      console.log('🎉 生成成功!');
      console.log('');
      console.log('📷 生成的图片:');
      statusData.resultUrls?.forEach((url, index) => {
        console.log(`   [${index + 1}] ${url}`);
      });
      console.log('');
      console.log(`⏱️ 总耗时: ${attempts * 2} 秒`);
      return;
    }

    if (statusData.status === 'FAILED') {
      console.log('');
      console.error('❌ 生成失败:', statusData.error);
      process.exit(1);
    }

    // 显示进度
    process.stdout.write(`\r   状态: ${statusData.status} (${attempts * 2}s)`);
  }

  console.log('');
  console.error('❌ 超时: 任务未在预期时间内完成');
  process.exit(1);
}

// 运行测试
testJimengGenerate().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});
