#!/usr/bin/env node

/**
 * Test R2 public URL access
 */

const R2_URL = 'https://a526a258cf79cefd6f476c93adcc8a93.r2.cloudflarestorage.com/gemini-images';
const TEST_KEY = `test-public-${Date.now()}.txt`;
const TEST_CONTENT = 'This is a test file for public access verification.';

console.log('='.repeat(70));
console.log('R2 Public URL Access Test');
console.log('='.repeat(70));
console.log('');

console.log('Testing direct upload and public URL access...\n');

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const client = new S3Client({
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function testPublicURL() {
  try {
    // Upload test file
    console.log('Uploading test file to R2...');
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: TEST_KEY,
      Body: TEST_CONTENT,
      ContentType: 'text/plain',
    }));
    console.log('✅ File uploaded');

    const publicUrl = `${R2_URL}/${TEST_KEY}`;
    console.log(`\nPublic URL: ${publicUrl}`);
    console.log('');

    // Try to access via public URL
    console.log('Testing public URL access...');
    const response = await fetch(publicUrl);

    console.log(`HTTP Status: ${response.status} ${response.statusText}`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);

    if (response.ok) {
      const content = await response.text();
      console.log(`\n✅ Public URL is accessible!`);
      console.log(`Content: ${content}`);
      console.log('\nR2 bucket has public access enabled.');
    } else {
      console.error('\n❌ Public URL is NOT accessible');
      console.error('\nPossible causes:');
      console.error('1. Bucket does NOT have public access enabled');
      console.error('2. Bucket is in a jurisdiction requiring different endpoint');
      console.error('\n📋 To enable public access:');
      console.error('   1. Go to Cloudflare Dashboard');
      console.error('   2. Navigate to: R2 → gemini-images → Settings');
      console.error('   3. Enable "Public Access"');
      console.error('   4. Optionally configure custom domain');
    }

    return response.ok;

  } catch (error) {
    console.error('Error:', error.message);
    return false;
  }
}

testPublicURL().then(success => {
  console.log('');
  console.log('='.repeat(70));
  if (success) {
    console.log('✅ R2 public access is working!');
  } else {
    console.log('⚠️  R2 bucket public access needs configuration');
  }
  console.log('='.repeat(70));
  process.exit(success ? 0 : 1);
});
