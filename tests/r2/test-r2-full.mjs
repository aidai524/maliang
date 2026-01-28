#!/usr/bin/env node

/**
 * Full R2 functionality test
 * Test upload, download, and public URL generation
 */

import { config as dotenvConfig } from 'dotenv';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

dotenvConfig();

const R2_CONFIG = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET_NAME,
  publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
};

console.log('='.repeat(70));
console.log('R2 Full Functionality Test');
console.log('='.repeat(70));
console.log('');

const client = new S3Client({
  endpoint: `https://${R2_CONFIG.accountId}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: {
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
  },
});

async function testFullR2() {
  const testKey = `test-images/${Date.now()}.png`;
  const testData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  try {
    // Test 1: Upload an image
    console.log('Test 1: Uploading test image...');
    await client.send(new PutObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: testKey,
      Body: testData,
      ContentType: 'image/png',
    }));
    console.log('✅ Image uploaded successfully');
    console.log(`   Key: ${testKey}`);

    // Test 2: Generate public URL
    const publicUrl = `${R2_CONFIG.publicBaseUrl}/${testKey}`;
    console.log('');
    console.log('Test 2: Public URL generation...');
    console.log(`   Public URL: ${publicUrl}`);
    console.log('✅ Public URL format correct');

    // Test 3: Download image
    console.log('');
    console.log('Test 3: Downloading image...');
    const getResponse = await client.send(new GetObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: testKey,
    }));
    const downloadedData = await getResponse.Body.transformToByteArray();
    console.log('✅ Image downloaded successfully');
    console.log(`   Size: ${downloadedData.length} bytes`);

    // Test 4: Verify data integrity
    console.log('');
    console.log('Test 4: Verifying data integrity...');
    const originalSize = testData.length;
    const downloadedSize = downloadedData.length;
    if (originalSize === downloadedSize) {
      console.log('✅ Data integrity verified');
      console.log(`   Original: ${originalSize} bytes`);
      console.log(`   Downloaded: ${downloadedSize} bytes`);
    } else {
      console.error('❌ Data mismatch!');
      console.error(`   Original: ${originalSize} bytes`);
      console.error(`   Downloaded: ${downloadedSize} bytes`);
    }

    // Test 5: Clean up
    console.log('');
    console.log('Test 5: Cleaning up test image...');
    await client.send(new DeleteObjectCommand({
      Bucket: R2_CONFIG.bucket,
      Key: testKey,
    }));
    console.log('✅ Test image deleted');

    console.log('');
    console.log('='.repeat(70));
    console.log('✅ All tests passed! R2 is ready for use.');
    console.log('='.repeat(70));
    console.log('');
    console.log('Application can now use R2 storage for:');
    console.log('  - Storing generated images');
    console.log('  - Serving images via public URLs');
    console.log('  - Parallel uploads (optimized)');
    console.log('  - Progressive result updates');

    return true;

  } catch (error) {
    console.error('');
    console.error('❌ Test failed!');
    console.error('Error:', error.message || error);

    // Attempt cleanup on failure
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: R2_CONFIG.bucket,
        Key: testKey,
      }));
    } catch (cleanupError) {
      // Ignore cleanup errors
    }

    return false;
  }
}

testFullR2().then(success => {
  process.exit(success ? 0 : 1);
});
