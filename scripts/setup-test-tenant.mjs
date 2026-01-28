/**
 * 创建测试租户和 API Key
 */

import pkg from '@prisma/client';
import crypto from 'crypto';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 创建测试租户...');

  // 生成 API Key
  const testApiKey = 'test_cache_key_' + Math.random().toString(36).substring(2, 15);

  // 计算哈希
  const apiKeyHash = crypto.createHash('sha256').update(testApiKey).digest('hex');

  // 创建或更新测试租户
  const tenant = await prisma.tenant.upsert({
    where: { id: 'test-cache-tenant' },
    update: {
      apiKeyHash,
      name: 'Cache Test Tenant',
      planRpm: 100,
      planConcurrency: 5,
      webhookEnabled: false,
    },
    create: {
      id: 'test-cache-tenant',
      apiKeyHash,
      name: 'Cache Test Tenant',
      planRpm: 100,
      planConcurrency: 5,
      webhookEnabled: false,
    },
  });

  console.log('✅ 测试租户创建成功!');
  console.log(`   Tenant ID: ${tenant.id}`);
  console.log(`   API Key: ${testApiKey}`);
  console.log('\n使用以下命令运行测试:');
  console.log(`export TEST_API_KEY="${testApiKey}"`);
  console.log('node scripts/test-cache-simple.mjs');

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('❌ 错误:', error);
  process.exit(1);
});
