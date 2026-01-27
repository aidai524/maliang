#!/usr/bin/env ts-node
/**
 * Reset script - clears all data from the database
 * WARNING: This will delete all tenants, jobs, and provider keys!
 */

import { prisma } from '../src/db/prisma';

async function main() {
  console.log('⚠️  WARNING: This will delete ALL data from the database!');
  console.log('⚠️  Type "yes" to confirm, or anything else to cancel.\n');

  // Wait for user input (simulate with timeout check)
  const args = process.argv.slice(2);
  if (args[0] !== 'yes') {
    console.log('❌ Cancelled. To reset, run: npm run reset yes');
    process.exit(0);
  }

  console.log('🗑️  Deleting all jobs...');
  await prisma.jobEvent.deleteMany({});
  await prisma.job.deleteMany({});

  console.log('🗑️  Deleting all tenants...');
  await prisma.tenant.deleteMany({});

  console.log('🗑️  Deleting all provider keys...');
  await prisma.providerKey.deleteMany({});

  console.log('\n✅ Database reset complete!');
  console.log('💡 Run "npm run init" to create initial data.\n');
}

main()
  .catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
