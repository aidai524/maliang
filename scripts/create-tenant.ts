#!/usr/bin/env ts-node
/**
 * Create a new tenant
 *
 * Usage: npm run create-tenant <name> [rpm] [concurrency]
 */

import { prisma } from '../src/db/prisma';
import { generateApiKey, generateWebhookSecret, sha256Hex } from '../src/utils/crypto';

async function main() {
  const name = process.argv[2] || 'New Tenant';
  const rpm = parseInt(process.argv[3]) || 60;
  const concurrency = parseInt(process.argv[4]) || 5;

  console.log(`Creating tenant: ${name}`);
  console.log(`Plan: ${rpm} RPM / ${concurrency} concurrent\n`);

  const apiKey = generateApiKey();

  const tenant = await prisma.tenant.create({
    data: {
      name,
      apiKeyHash: sha256Hex(apiKey),
      planRpm: rpm,
      planConcurrency: concurrency,
      webhookSecret: generateWebhookSecret(),
    },
  });

  console.log('✅ Tenant created:');
  console.log(`   ID: ${tenant.id}`);
  console.log(`   Name: ${tenant.name}`);
  console.log(`   📌 API Key: ${apiKey}`);
  console.log(`   📊 Plan: ${tenant.planRpm} RPM / ${tenant.planConcurrency} concurrent\n`);
}

main()
  .catch((error) => {
    console.error('❌ Failed to create tenant:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
