#!/usr/bin/env node

/**
 * R2 documentation-based test
 * Based on: https://developers.cloudflare.com/r2/api/tokens/
 */

import { config as dotenvConfig } from 'dotenv';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

dotenvConfig();

console.log('='.repeat(70));
console.log('R2 Credentials Test (Based on Cloudflare Documentation)');
console.log('='.repeat(70));
console.log('');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

console.log('Credentials:');
console.log('  Account ID:', ACCOUNT_ID);
console.log('  Access Key ID:', ACCESS_KEY_ID, `(${ACCESS_KEY_ID?.length} chars)`);
console.log('  Secret Access Key:', SECRET_ACCESS_KEY?.substring(0, 10) + '...', `(${SECRET_ACCESS_KEY?.length} chars)`);
console.log('  Bucket:', BUCKET_NAME);
console.log('');

// Important: Cloudflare R2 uses the standard endpoint format
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
console.log('Endpoint:', ENDPOINT);
console.log('');

const client = new S3Client({
  endpoint: ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
  },
});

async function testConnection() {
  try {
    console.log('Testing connection to R2...\n');

    const response = await client.send(new ListBucketsCommand({}));

    console.log('✅ Connection successful!\n');
    console.log('Found', response.Buckets?.length || 0, 'bucket(s)');

    if (response.Buckets && response.Buckets.length > 0) {
      console.log('');
      response.Buckets.forEach(bucket => {
        const isOurBucket = bucket.Name === BUCKET_NAME;
        const marker = isOurBucket ? ' ← YOUR BUCKET' : '';
        console.log(`  ${bucket.Name}${marker}`);
      });
      console.log('');

      const bucketExists = response.Buckets.some(b => b.Name === BUCKET_NAME);
      if (bucketExists) {
        console.log('✅ Bucket "' + BUCKET_NAME + '" exists');
        console.log('');
        console.log('Configuration is correct!');
        console.log('You can now start the application.');
      } else {
        console.log('⚠️  Bucket "' + BUCKET_NAME + '" NOT found');
        console.log('');
        console.log('Please create it in Cloudflare Dashboard:');
        console.log('  R2 → Create bucket → Name: gemini-images');
      }
    }

    return true;

  } catch (error) {
    console.error('❌ Connection failed!\n');
    console.error('Error:', error.name);
    console.error('Message:', error.message);

    if (error.name === 'AccessDenied') {
      console.error('\n🔍 Access Denied - Possible causes:');
      console.error('');
      console.error('1. Token Permission Issue');
      console.error('   - Token must have: Object Read + Object Write permissions');
      console.error('   - Check: Cloudflare Dashboard → R2 → API Tokens → gemini-images-storage');
      console.error('   - Click token name → Verify permissions');
      console.error('');
      console.error('2. Bucket Access Scope Issue');
      console.error('   - If token has "Object Read & Write" permission');
      console.error('   - It should have access to: "All R2 buckets"');
      console.error('   - OR specifically include: gemini-images bucket');
      console.error('');
      console.error('3. Token Revoked or Expired');
      console.error('   - Delete and recreate the token');
    }

    return false;
  }
}

testConnection().then(success => {
  console.log('');
  console.log('='.repeat(70));
  if (success) {
    console.log('✅ R2 configuration is working!');
  } else {
    console.log('❌ Please check the issues above and retry');
  }
  console.log('='.repeat(70));
});
