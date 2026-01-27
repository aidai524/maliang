#!/usr/bin/env ts-node
/**
 * Test script for the API
 *
 * Run this after starting the server to test basic functionality
 */

import { prisma } from '../src/db/prisma';

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

async function getTestTenant() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    console.error('❌ No tenant found. Run "npm run init" first.');
    process.exit(1);
  }

  // For testing, we need to get or create an API key
  // In production, the API key is hashed and can't be retrieved
  console.log('\n⚠️  Note: API keys are hashed in the database.');
  console.log('⚠️  You need to use the API key that was displayed during "npm run init".\n');

  return tenant;
}

async function testGenerateImage(apiKey: string) {
  console.log('📸 Testing image generation...\n');

  const response = await fetch(`${API_BASE}/v1/images/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: 'A simple red apple on a white background',
      mode: 'draft',
    }),
  });

  const data = await response.json();

  if (response.ok) {
    console.log('✅ Image generation job submitted!');
    console.log(`   Job ID: ${data.jobId}`);
    console.log(`   Status: ${data.status}\n`);
    return data.jobId;
  } else {
    console.error('❌ Failed to submit job:');
    console.error(JSON.stringify(data, null, 2));
    return null;
  }
}

async function testGetJob(apiKey: string, jobId: string) {
  console.log('🔍 Checking job status...\n');

  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  const data = await response.json();

  if (response.ok) {
    console.log('✅ Job status retrieved!');
    console.log(`   Status: ${data.status}`);
    if (data.resultUrls && data.resultUrls.length > 0) {
      console.log(`   Images: ${data.resultUrls.length}`);
      data.resultUrls.forEach((url: string, i: number) => {
        console.log(`      [${i + 1}] ${url}`);
      });
    }
    if (data.error) {
      console.log(`   Error: ${data.error.code} - ${data.error.message}`);
    }
    console.log('');
    return data;
  } else {
    console.error('❌ Failed to get job:');
    console.error(JSON.stringify(data, null, 2));
    return null;
  }
}

async function testListJobs(apiKey: string) {
  console.log('📋 Listing jobs...\n');

  const response = await fetch(`${API_BASE}/v1/jobs`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  const data = await response.json();

  if (response.ok) {
    console.log(`✅ Found ${data.items.length} job(s)`);
    data.items.forEach((job: any) => {
      console.log(`   - ${job.id}: ${job.status}`);
    });
    console.log('');
    return data;
  } else {
    console.error('❌ Failed to list jobs:');
    console.error(JSON.stringify(data, null, 2));
    return null;
  }
}

async function testHealth() {
  console.log('💓 Testing health endpoint...\n');

  const response = await fetch(`${API_BASE}/health`);
  const data = await response.json();

  if (response.ok) {
    console.log('✅ API is healthy!');
    console.log(`   ${JSON.stringify(data)}\n`);
  } else {
    console.error('❌ API health check failed\n');
    process.exit(1);
  }
}

async function main() {
  console.log('🧪 Image SaaS API Test');
  console.log('═════════════════════════════════════════════════════════\n');
  console.log(`API Base: ${API_BASE}\n`);

  // Check health
  await testHealth();

  // Get tenant info
  const tenant = await getTestTenant();

  // Prompt for API key
  console.log('📝 Enter your API key (from "npm run init" output):');
  console.log('   Or press Enter to skip interactive tests.\n');

  // Since we can't read stdin easily in this script,
  // we'll just print instructions
  console.log('═════════════════════════════════════════════════════════');
  console.log('📖 Manual Test Commands');
  console.log('═════════════════════════════════════════════════════════\n');

  console.log('Replace YOUR_API_KEY with the key from "npm run init"\n');

  console.log('1️⃣  Submit a generation job:');
  console.log(`   curl -X POST ${API_BASE}/v1/images/generate \\
     -H "Authorization: Bearer YOUR_API_KEY" \\
     -H "Content-Type: application/json" \\
     -d '{"prompt":"A cute cat","mode":"draft"}'\n`);

  console.log('2️⃣  Check job status:');
  console.log(`   curl ${API_BASE}/v1/jobs/JOB_ID \\
     -H "Authorization: Bearer YOUR_API_KEY"\n`);

  console.log('3️⃣  List all jobs:');
  console.log(`   curl ${API_BASE}/v1/jobs \\
     -H "Authorization: Bearer YOUR_API_KEY"\n`);
}

main()
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
