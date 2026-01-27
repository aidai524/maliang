#!/usr/bin/env node

/**
 * Simple R2 connection test - verify credentials only
 */

import { config as dotenvConfig } from 'dotenv';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

dotenvConfig();

console.log('Testing R2 credentials...\n');

const s3Client = new S3Client({
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

try {
  const response = await s3Client.send(new ListBucketsCommand({}));
  console.log('✓ Connection successful!\n');
  console.log('Found buckets:');
  response.Buckets?.forEach(bucket => {
    console.log(`  - ${bucket.Name}`);
    console.log(`    Created: ${bucket.CreationDate}`);
  });
  console.log('');
  console.log(`Looking for bucket: "${process.env.R2_BUCKET_NAME}"`);

  const bucketExists = response.Buckets?.some(b => b.Name === process.env.R2_BUCKET_NAME);
  if (bucketExists) {
    console.log('✓ Bucket exists!\n');
    console.log('Next step: Check bucket permissions');
    console.log('Please ensure the bucket has public read access enabled.');
    console.log('Go to: Cloudflare Dashboard → R2 → gemini-images → Settings → Public Access');
  } else {
    console.log('✗ Bucket NOT found!\n');
    console.log('Please create the bucket "gemini-images" in your R2 dashboard.');
    console.log('Go to: Cloudflare Dashboard → R2 → Create bucket');
  }

} catch (error) {
  console.error('✗ Connection failed!\n');
  console.error('Error:', error.message || error);

  console.error('\nPossible issues:');
  console.error('1. Access Key ID is incorrect');
  console.error('2. Secret Access Key is incorrect');
  console.error('3. Token permissions are insufficient');
  console.error('\nPlease recreate the R2 API Token with:');
  console.error('  - Object Read');
  console.error('  - Object Write');
  console.error('  - Object Delete');
  console.error('  - Bucket: All R2 buckets');
}
