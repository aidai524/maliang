#!/usr/bin/env ts-node
/**
 * Initialization script for Image SaaS
 *
 * Creates test tenants and provider keys in the database.
 */

import { prisma } from '../src/db/prisma';
import { generateApiKey, generateWebhookSecret, sha256Hex } from '../src/utils/crypto';

async function main() {
  console.log('🚀 Initializing Image SaaS...\n');

  // Check if already initialized
  const existingTenants = await prisma.tenant.count();
  if (existingTenants > 0) {
    console.log(`⚠️  Database already has ${existingTenants} tenant(s). Skipping tenant creation.\n`);
    await listTenants();
    await listProviderKeys();
    return;
  }

  // ========== CREATE TEST TENANT ==========
  console.log('📝 Creating test tenant...');

  // Use TEST_API_KEY from env if provided, otherwise generate one
  const testApiKey = process.env.TEST_API_KEY || generateApiKey();

  if (process.env.TEST_API_KEY) {
    console.log('📌 Using TEST_API_KEY from environment');
  }

  const testTenant = await prisma.tenant.create({
    data: {
      name: 'Test Tenant',
      apiKeyHash: sha256Hex(testApiKey),
      planRpm: 60,           // 60 requests per minute
      planConcurrency: 5,    // 5 concurrent requests
      webhookUrl: 'https://webhook.site/your-unique-url', // Replace with actual webhook.site URL for testing
      webhookSecret: generateWebhookSecret(),
      webhookEnabled: false,  // Disabled by default, enable when testing
    },
  });

  console.log('✅ Test tenant created:');
  console.log(`   ID: ${testTenant.id}`);
  console.log(`   Name: ${testTenant.name}`);
  console.log(`   API Key: ${testApiKey} ⚠️  Save this key!`);
  console.log(`   Plan: ${testTenant.planRpm} RPM, ${testTenant.planConcurrency} concurrency\n`);

  // ========== CREATE PROVIDER KEYS ==========
  console.log('🔑 Creating provider keys...');

  const providerKeys = [
    {
      provider: 'gemini',
      encryptedKey: process.env.GEMINI_API_KEY_1 || 'your-first-gemini-api-key',
      rpmLimit: 60,
      concurrencyLimit: 2,
    },
    {
      provider: 'gemini',
      encryptedKey: process.env.GEMINI_API_KEY_2 || 'your-second-gemini-api-key',
      rpmLimit: 60,
      concurrencyLimit: 2,
    },
  ];

  for (const keyData of providerKeys) {
    await prisma.providerKey.create({
      data: keyData,
    });
    console.log(`✅ Provider key created: ${keyData.provider}`);
  }

  console.log('\n✨ Initialization complete!\n');

  // Print summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📋 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n🏢 Tenant: ${testTenant.name}`);
  console.log(`   ID: ${testTenant.id}`);
  console.log(`   📌 API Key: ${testApiKey}`);
  console.log(`   📊 Plan: ${testTenant.planRpm} RPM / ${testTenant.planConcurrency} concurrent`);
  console.log(`   🔔 Webhook: ${testTenant.webhookEnabled ? 'Enabled' : 'Disabled'}`);
  if (testTenant.webhookUrl) {
    console.log(`   📡 Webhook URL: ${testTenant.webhookUrl}`);
  }
  console.log(`   🔐 Webhook Secret: ${testTenant.webhookSecret}\n`);

  console.log(`🔑 Provider Keys: ${providerKeys.length} configured`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('🧪 To test the API:');
  console.log(`   curl -X POST http://localhost:3000/v1/images/generate \\
     -H "Authorization: Bearer ${testApiKey}" \\
     -H "Content-Type: application/json" \\
     -d '{"prompt":"A cute cat"}'\n`);

  console.log('📖 To check job status:');
  console.log(`   curl http://localhost:3000/v1/jobs/{{JOB_ID}} \\
     -H "Authorization: Bearer ${testApiKey}"\n`);
}

async function listTenants() {
  console.log('📋 Existing tenants:');
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      planRpm: true,
      planConcurrency: true,
      apiKeyHash: true,
      webhookEnabled: true,
      webhookUrl: true,
      createdAt: true,
    },
  });

  if (tenants.length === 0) {
    console.log('   No tenants found.\n');
    return;
  }

  for (const tenant of tenants) {
    console.log(`\n   🏢 ${tenant.name}`);
    console.log(`      ID: ${tenant.id}`);
    console.log(`      Plan: ${tenant.planRpm} RPM / ${tenant.planConcurrency} concurrent`);
    console.log(`      API Key Hash: ${tenant.apiKeyHash.substring(0, 16)}...`);
    console.log(`      Webhook: ${tenant.webhookEnabled ? '✅' : '❌'}`);
    if (tenant.webhookUrl) {
      console.log(`      Webhook URL: ${tenant.webhookUrl}`);
    }
    console.log(`      Created: ${tenant.createdAt.toLocaleString()}`);
  }
  console.log();
}

async function listProviderKeys() {
  console.log('🔑 Existing provider keys:');
  const keys = await prisma.providerKey.findMany({
    select: {
      id: true,
      provider: true,
      rpmLimit: true,
      concurrencyLimit: true,
      enabled: true,
      createdAt: true,
    },
  });

  if (keys.length === 0) {
    console.log('   No provider keys found.\n');
    return;
  }

  for (const key of keys) {
    console.log(`\n   🔑 Provider: ${key.provider}`);
    console.log(`      ID: ${key.id}`);
    console.log(`      Limits: ${key.rpmLimit} RPM / ${key.concurrencyLimit} concurrent`);
    console.log(`      Status: ${key.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`      Created: ${key.createdAt.toLocaleString()}`);
  }
  console.log();
}

main()
  .catch((error) => {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
