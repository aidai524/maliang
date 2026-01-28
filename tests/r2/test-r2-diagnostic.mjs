#!/usr/bin/env node

/**
 * Detailed R2 diagnostic test
 */

import { config as dotenvConfig } from 'dotenv';
import { S3Client, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

dotenvConfig();

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

console.log('='.repeat(60));
console.log('R2 Configuration Diagnostic');
console.log('='.repeat(60));
console.log('');

console.log('Account ID:', ACCOUNT_ID);
console.log('Access Key ID:', ACCESS_KEY_ID);
console.log('Secret Access Key length:', SECRET_ACCESS_KEY?.length);
console.log('Bucket Name:', BUCKET_NAME);
console.log('');

// Check Secret Access Key format
if (SECRET_ACCESS_KEY?.length !== 40) {
  console.error('⚠️  WARNING: Secret Access Key should be 40 characters');
  console.error('   Current length:', SECRET_ACCESS_KEY?.length);
  console.error('');
}

if (ACCESS_KEY_ID?.length !== 20) {
  console.error('⚠️  WARNING: Access Key ID should be 20 characters');
  console.error('   Current length:', ACCESS_KEY_ID?.length);
  console.error('');
}

const client = new S3Client({
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

async function runTests() {
  console.log('Running tests...\n');

  // Test 1: List buckets
  console.log('Test 1: List all buckets');
  console.log('-'.repeat(40));
  try {
    const response = await client.send(new ListBucketsCommand({}));
    console.log('✓ Success! Found', response.Buckets?.length || 0, 'bucket(s)');

    if (response.Buckets && response.Buckets.length > 0) {
      response.Buckets.forEach(bucket => {
        console.log(`  - ${bucket.Name} (created: ${bucket.CreationDate})`);
      });
    }

    // Check if our bucket exists
    const bucketExists = response.Buckets?.some(b => b.Name === BUCKET_NAME);
    console.log(`\nBucket "${BUCKET_NAME}" exists: ${bucketExists ? 'YES ✓' : 'NO ✗'}`);

    if (!bucketExists) {
      console.log('\n⚠️  Action needed: Create bucket in Cloudflare Dashboard');
      console.log('   Go to: https://dash.cloudflare.com/[account]/r2');
      console.log('   Create bucket named: gemini-images');
    }

    return true;

  } catch (error) {
    console.error('✗ Failed');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);

    if (error.name === 'AccessDenied') {
      console.error('\n🔍 ACCESS DENIED - Most likely causes:');
      console.error('1. Invalid credentials (wrong access key or secret key)');
      console.error('2. Token does not have required permissions');
      console.error('3. Token is expired or revoked');
      console.error('\n📋 Required permissions for R2 API Token:');
      console.error('   ✅ Object Read');
      console.error('   ✅ Object Write');
      console.error('   ✅ Object Delete');
      console.error('   ✅ Bucket access: All R2 buckets');
    }

    if (error.name === 'InvalidAccessKeyId') {
      console.error('\n🔍 INVALID ACCESS KEY ID');
      console.error('The Access Key ID is not recognized by R2.');
    }

    if (error.name === 'SignatureDoesNotMatch') {
      console.error('\n🔍 SIGNATURE DOES NOT MATCH');
      console.error('The Secret Access Key is incorrect.');
    }

    return false;
  }
}

runTests().then(success => {
  console.log('');
  console.log('='.repeat(60));
  if (success) {
    console.log('✓ R2 connection is working!');
    console.log('='.repeat(60));
    console.log('\nNext steps:');
    console.log('1. Ensure bucket has public access enabled');
    console.log('2. Test file upload/download');
    console.log('3. Start the application');
  } else {
    console.log('✗ R2 connection failed');
    console.log('='.repeat(60));
    console.log('\nPlease check:');
    console.log('1. Credentials are copied correctly (no extra spaces/newlines)');
    console.log('2. Token has correct permissions');
    console.log('3. Recreate token if needed');
  }
});
