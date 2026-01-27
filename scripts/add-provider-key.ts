#!/usr/bin/env ts-node
/**
 * Add a new provider key
 *
 * Usage: npm run add-provider-key <provider> <api-key> [rpm] [concurrency]
 */

import { prisma } from '../src/db/prisma';

async function main() {
  const provider = process.argv[2] || 'gemini';
  const apiKey = process.argv[3];
  const rpm = parseInt(process.argv[4]) || 60;
  const concurrency = parseInt(process.argv[5]) || 2;

  if (!apiKey) {
    console.error('❌ API key is required!');
    console.error('Usage: npm run add-provider-key <provider> <api-key> [rpm] [concurrency]');
    process.exit(1);
  }

  console.log(`Adding provider key for: ${provider}`);
  console.log(`Limits: ${rpm} RPM / ${concurrency} concurrent\n`);

  const key = await prisma.providerKey.create({
    data: {
      provider,
      encryptedKey: apiKey,
      rpmLimit: rpm,
      concurrencyLimit: concurrency,
      enabled: true,
    },
  });

  console.log('✅ Provider key created:');
  console.log(`   ID: ${key.id}`);
  console.log(`   Provider: ${key.provider}`);
  console.log(`   RPM Limit: ${key.rpmLimit}`);
  console.log(`   Concurrency Limit: ${key.concurrencyLimit}\n`);
}

main()
  .catch((error) => {
    console.error('❌ Failed to add provider key:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
