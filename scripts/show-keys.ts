#!/usr/bin/env ts-node
/**
 * Get and display API keys for tenants
 *
 * Usage: npm run show-keys
 */

import { prisma } from '../src/db/prisma';

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      apiKeyHash: true,
      planRpm: true,
      planConcurrency: true,
      createdAt: true,
    },
  });

  if (tenants.length === 0) {
    console.log('❌ No tenants found. Run "npm run init" first.\n');
    return;
  }

  console.log('📋 Tenant API Keys:\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const tenant of tenants) {
    console.log(`🏢 ${tenant.name}`);
    console.log(`   ID: ${tenant.id}`);
    console.log(`   Plan: ${tenant.planRpm} RPM / ${tenant.planConcurrency} concurrent`);
    console.log(`   API Key Hash: ${tenant.apiKeyHash}`);
    console.log(`   Created: ${tenant.createdAt.toLocaleString()}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('⚠️  Note: API keys are hashed and cannot be retrieved.');
  console.log('💡 If you set TEST_API_KEY in .env, use that key for testing.\n');

  // Check if TEST_API_KEY is set in .env
  const testKey = process.env.TEST_API_KEY;
  if (testKey) {
    console.log('✅ TEST_API_KEY is configured in .env:');
    console.log(`   ${testKey}\n`);
  } else {
    console.log('💡 To use a fixed test API key, add TEST_API_KEY to your .env file:\n');
    console.log('   TEST_API_KEY=img_test_your_fixed_key_here\n');
  }
}

main()
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
