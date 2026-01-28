#!/usr/bin/env ts-node
/**
 * Add a new provider key
 *
 * Usage: npm run add-provider-key <provider> <api-key> [options]
 * 
 * Options:
 *   --endpoint <name>     Endpoint name (default: official)
 *   --rpm <number>        RPM limit (default: 60)
 *   --conc <number>       Concurrency limit (default: 2)
 *   --priority <number>   Priority level, lower = higher priority (default: 1)
 * 
 * Examples:
 *   npm run add-provider-key gemini AIzaSy... --endpoint official --rpm 60 --conc 2
 *   npm run add-provider-key gemini sk-... --endpoint yunwu --priority 2 --rpm 100
 */

import { prisma } from '../src/db/prisma';

function parseArgs() {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  
  // First two positional args
  result.provider = args[0] || 'gemini';
  result.apiKey = args[1] || '';
  
  // Parse named options
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        result[key] = value;
        i++;
      }
    }
  }
  
  return result;
}

async function main() {
  const args = parseArgs();
  
  const provider = args.provider;
  const apiKey = args.apiKey;
  const endpoint = args.endpoint || 'official';
  const rpm = parseInt(args.rpm) || 60;
  const concurrency = parseInt(args.conc) || 2;
  const priority = parseInt(args.priority) || (endpoint === 'official' ? 1 : 2);

  if (!apiKey) {
    console.error('❌ API key is required!');
    console.error('');
    console.error('Usage: npm run add-provider-key <provider> <api-key> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --endpoint <name>     Endpoint name (default: official)');
    console.error('  --rpm <number>        RPM limit (default: 60)');
    console.error('  --conc <number>       Concurrency limit (default: 2)');
    console.error('  --priority <number>   Priority level, lower = higher (default: 1 for official, 2 for others)');
    console.error('');
    console.error('Examples:');
    console.error('  npm run add-provider-key gemini AIzaSy... --endpoint official');
    console.error('  npm run add-provider-key gemini sk-... --endpoint yunwu --priority 2');
    process.exit(1);
  }

  console.log(`Adding provider key for: ${provider}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Priority: ${priority}`);
  console.log(`Limits: ${rpm} RPM / ${concurrency} concurrent\n`);

  const key = await prisma.providerKey.create({
    data: {
      provider,
      endpoint,
      encryptedKey: apiKey,
      rpmLimit: rpm,
      concurrencyLimit: concurrency,
      priority,
      enabled: true,
    },
  });

  console.log('✅ Provider key created:');
  console.log(`   ID: ${key.id}`);
  console.log(`   Provider: ${key.provider}`);
  console.log(`   Endpoint: ${key.endpoint}`);
  console.log(`   Priority: ${key.priority}`);
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
