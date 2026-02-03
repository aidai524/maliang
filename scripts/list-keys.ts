#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const keys = await prisma.providerKey.findMany({
    select: {
      id: true,
      provider: true,
      endpoint: true,
      enabled: true,
      rpmLimit: true,
      concurrencyLimit: true,
      priority: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log('\n📋 Provider Keys 配置列表:\n');
  console.log('Endpoint       | Status | Priority | RPM  | Concurrent | Created');
  console.log(''.padEnd(90, '-'));

  keys.forEach(k => {
    const endpoint = k.endpoint.padEnd(12);
    const status = k.enabled ? '✅ Enabled' : '❌ Disabled';
    const priority = k.priority.toString().padStart(3);
    const rpm = k.rpmLimit.toString().padStart(4);
    const concurrent = k.concurrencyLimit.toString().padStart(4);
    const created = k.createdAt.toLocaleString();

    console.log(`${endpoint} | ${status.padEnd(9)} | ${priority}    | ${rpm} | ${concurrent}       | ${created}`);
  });

  console.log('\n总计:', keys.length, '个 Provider Keys\n');

  // 统计各 endpoint 的数量
  const endpointStats = keys.reduce((acc, k) => {
    acc[k.endpoint] = (acc[k.endpoint] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('📊 Endpoint 统计:');
  Object.entries(endpointStats).forEach(([endpoint, count]) => {
    console.log(`  ${endpoint.padEnd(12)}: ${count} 个 keys`);
  });
  console.log();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
