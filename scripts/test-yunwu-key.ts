#!/usr/bin/env ts-node
/**
 * 测试云雾 API Key 配置
 *
 * 使用方法：
 *   npm run test-yunwu <YOUR_API_KEY>
 *
 * 示例：
 *   npm run test-yunwu img_test_xxxxx
 */

import { prisma } from '../src/db/prisma';

async function main() {
  const apiKey = process.argv[2];

  if (!apiKey) {
    console.error('❌ 请提供 API Key');
    console.error('');
    console.error('使用方法:');
    console.error('  npm run test-yunwu <YOUR_API_KEY>');
    console.error('');
    console.error('或者直接使用 ts-node:');
    console.error('  npx ts-node scripts/test-yunwu-key.ts <YOUR_API_KEY>');
    process.exit(1);
  }

  console.log('🧪 测试云雾 API Key 配置...\n');

  // 1. 检查租户
  const sha256 = async (str: string) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const hash = await sha256(apiKey);
  const tenant = await prisma.tenant.findFirst({
    where: { apiKeyHash: hash },
  });

  if (!tenant) {
    console.error('❌ 未找到匹配的租户，请检查 API Key 是否正确');
    process.exit(1);
  }

  console.log('✅ 租户验证成功');
  console.log(`   租户 ID: ${tenant.id}`);
  console.log(`   租户名称: ${tenant.name}`);
  console.log(`   计划限制: ${tenant.planRpm} RPM / ${tenant.planConcurrency} 并发\n`);

  // 2. 检查云雾 Provider Keys
  const yunwuKeys = await prisma.providerKey.findMany({
    where: {
      provider: 'gemini',
      endpoint: 'yunwu',
      enabled: true,
    },
    select: {
      id: true,
      endpoint: true,
      priority: true,
      rpmLimit: true,
      concurrencyLimit: true,
      createdAt: true,
    },
  });

  if (yunwuKeys.length === 0) {
    console.error('❌ 未找到已启用的云雾 Provider Keys');
    console.error('   请运行以下命令添加：');
    console.error('   npx ts-node scripts/add-provider-key.ts gemini YOUR_API_KEY --endpoint yunwu');
    process.exit(1);
  }

  console.log(`✅ 找到 ${yunwuKeys.length} 个云雾 Provider Keys`);
  yunwuKeys.forEach((key, index) => {
    console.log(`   Key ${index + 1}:`);
    console.log(`     ID: ${key.id}`);
    console.log(`     优先级: ${key.priority}`);
    console.log(`     限制: ${key.rpmLimit} RPM / ${key.concurrencyLimit} 并发`);
    console.log(`     创建时间: ${key.createdAt.toLocaleString()}`);
  });
  console.log();

  // 3. 测试 API 调用
  console.log('🚀 测试图片生成接口...\n');

  try {
    const response = await fetch('http://localhost:3000/v1/images/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A cute cat',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ API 调用失败');
      console.error(`   HTTP ${response.status}: ${response.statusText}`);
      console.error(`   响应: ${error}`);
      process.exit(1);
    }

    const data = await response.json();
    console.log('✅ API 调用成功！');
    console.log(`   Job ID: ${data.jobId}`);
    console.log(`   状态: ${data.status}\n`);

    console.log('📋 查看任务状态：');
    console.log(`   curl http://localhost:3000/v1/jobs/${data.jobId} \\`);
    console.log(`     -H "Authorization: Bearer ${apiKey}"\n`);

    console.log('✨ 配置测试完成！云雾 API 已正常工作。');
  } catch (error: any) {
    console.error('❌ API 调用异常');
    console.error(`   错误: ${error.message}`);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
