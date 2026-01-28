#!/usr/bin/env node

/**
 * Test R2 storage configuration
 * Usage: node test-r2.mjs
 */

import { config as dotenvConfig } from 'dotenv';
import { S3Client, ListBucketsCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

dotenvConfig();

const R2_CONFIG = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET_NAME,
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  storageType: process.env.STORAGE_TYPE,
};

console.log('Testing R2 configuration...\n');
console.log('Account ID:', R2_CONFIG.accountId);
console.log('Bucket:', R2_CONFIG.bucket);
console.log('Public Base URL:', R2_CONFIG.publicBaseUrl);
console.log('Storage Type:', R2_CONFIG.storageType);
console.log('');

if (!R2_CONFIG.accountId || !R2_CONFIG.accessKeyId || !R2_CONFIG.secretAccessKey || !R2_CONFIG.bucket) {
  console.error('✗ Missing R2 configuration in .env file');
  console.error('Please set:');
  console.error('  - R2_ACCOUNT_ID');
  console.error('  - R2_ACCESS_KEY_ID');
  console.error('  - R2_SECRET_ACCESS_KEY');
  console.error('  - R2_BUCKET_NAME');
  console.error('  - R2_PUBLIC_BASE_URL');
  process.exit(1);
}

const s3Client = new S3Client({
  endpoint: `https://${R2_CONFIG.accountId}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
});

async function testR2() {
  try {
    // Test 1: List buckets
    console.log('Test 1: Listing buckets...');
    const bucketsResponse = await s3Client.send(new ListBucketsCommand({}));
    const bucketExists = bucketsResponse.Buckets?.some(b => b.Name === R2_CONFIG.bucket);
    console.log('✓ Buckets listed successfully');
    console.log(`  Bucket "${R2_CONFIG.bucket}" exists: ${bucketExists}`);
    console.log('');

    if (!bucketExists) {
      console.log(`✗ Bucket "${R2_CONFIG.bucket}" not found. Please create it first.`);
      return;
    }

    // Test 2: Upload a test file
    console.log('Test 2: Uploading test file...');
    const testKey = `test-${Date.now()}.txt`;
    const testContent = 'Hello from R2!';

    await s3Client.send(new PutObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
    }));

    console.log('✓ Test file uploaded successfully');
    console.log(`  Key: ${testKey}`);
    console.log('');

    // Test 3: Download test file
    console.log('Test 3: Downloading test file...');
    const getResponse = await s3Client.send(new GetObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: testKey,
    }));

    const downloadedContent = await getResponse.Body.transformToString();
    console.log('✓ Test file downloaded successfully');
    console.log(`  Content: ${downloadedContent}`);
    console.log('');

    // Test 4: Verify public URL format
    const publicUrl = `${R2_CONFIG.publicBaseUrl}/${testKey}`;
    console.log('Test 4: Public URL format...');
    console.log('✓ Public URL:', publicUrl);
    console.log('');

    // Test 5: Clean up
    console.log('Test 5: Cleaning up test file...');
    await s3Client.send(new DeleteObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: testKey,
    }));
    console.log('✓ Test file deleted');
    console.log('');

    console.log('='.repeat(50));
    console.log('All tests passed! R2 configuration is correct.');
    console.log('='.repeat(50));
    console.log('');
    console.log('Note: Make sure to set STORAGE_TYPE=r2 in .env to use R2 storage.');
    console.log('      Current STORAGE_TYPE:', R2_CONFIG.storageType);

  } catch (error) {
    console.error('');
    console.error('✗ Test failed with error:');
    console.error(error.message || error);
    console.error('');
    console.error('Please check:');
    console.error('1. Account ID is correct');
    console.error('2. Access Key ID and Secret Access Key are valid');
    console.error('3. Bucket exists and has correct permissions');
    console.error('4. Network connectivity to R2 is working');
    process.exit(1);
  }
}

testR2();
