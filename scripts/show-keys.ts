#!/usr/bin/env ts-node
/**
 * Get and display API keys for tenants and provider keys
 *
 * Usage: npm run show-keys
 */

import { prisma } from '../src/db/prisma';

async function main() {
  // ========== SHOW TENANTS ==========
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
  } else {
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

  // ========== SHOW PROVIDER KEYS ==========
  const providerKeys = await prisma.providerKey.findMany({
    select: {
      id: true,
      provider: true,
      endpoint: true,
      rpmLimit: true,
      concurrencyLimit: true,
      priority: true,
      enabled: true,
      createdAt: true,
    },
    orderBy: [
      { provider: 'asc' },
      { priority: 'asc' },
      { endpoint: 'asc' },
    ],
  });

  console.log('\n🔑 Provider Keys:\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (providerKeys.length === 0) {
    console.log('❌ No provider keys found.\n');
    console.log('💡 Add a provider key with:\n');
    console.log('   npm run add-provider-key gemini <api-key> --endpoint official');
    console.log('   npm run add-provider-key gemini <api-key> --endpoint yunwu --priority 2\n');
  } else {
    // Group by provider
    const byProvider: Record<string, typeof providerKeys> = {};
    for (const key of providerKeys) {
      if (!byProvider[key.provider]) {
        byProvider[key.provider] = [];
      }
      byProvider[key.provider].push(key);
    }

    for (const [provider, keys] of Object.entries(byProvider)) {
      console.log(`🌐 Provider: ${provider.toUpperCase()}`);
      console.log('   ─────────────────────────────────────────────────────────\n');

      // Group by endpoint
      const byEndpoint: Record<string, typeof keys> = {};
      for (const key of keys) {
        if (!byEndpoint[key.endpoint]) {
          byEndpoint[key.endpoint] = [];
        }
        byEndpoint[key.endpoint].push(key);
      }

      for (const [endpoint, endpointKeys] of Object.entries(byEndpoint)) {
        console.log(`   📡 Endpoint: ${endpoint} (Priority: ${endpointKeys[0].priority})`);
        
        for (const key of endpointKeys) {
          const status = key.enabled ? '✅' : '❌';
          console.log(`      ${status} ${key.id}`);
          console.log(`         RPM: ${key.rpmLimit} | Concurrency: ${key.concurrencyLimit}`);
        }
        console.log('');
      }
    }

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('📊 Summary:');
    
    // Count by endpoint
    const endpointCounts: Record<string, number> = {};
    for (const key of providerKeys) {
      const label = `${key.provider}/${key.endpoint}`;
      endpointCounts[label] = (endpointCounts[label] || 0) + 1;
    }
    
    for (const [label, count] of Object.entries(endpointCounts)) {
      console.log(`   ${label}: ${count} key(s)`);
    }
    console.log('');
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
