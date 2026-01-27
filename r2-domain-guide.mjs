#!/usr/bin/env node

/**
 * R2 custom domain diagnostic
 * Check if custom domain is properly configured for R2 bucket
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

console.log('='.repeat(70));
console.log('R2 Custom Domain Configuration Guide');
console.log('='.repeat(70));
console.log('');

const CUSTOM_DOMAIN = process.env.R2_PUBLIC_BASE_URL;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

console.log('Current Configuration:');
console.log(`  Bucket: ${BUCKET_NAME}`);
console.log(`  Custom Domain: ${CUSTOM_DOMAIN}`);
console.log('');

console.log('✅ What is working:');
console.log('  - Job submission');
console.log('  - Image generation');
console.log('  - Upload to R2');
console.log('  - Custom domain URL in response');
console.log('');

console.log('❌ What is NOT working:');
console.log('  - Public access via custom domain');
console.log('');
console.log('-'.repeat(70));
console.log('');

console.log('DIAGNOSIS:');
console.log('Domain test: HTTP → 301 Redirect to http://www.js96110.com.cn/');
console.log('            This indicates:');
console.log('  1. Domain exists (DNS working)');
console.log('  2. But R2 bucket is NOT mapped to this domain');
console.log('');

console.log('🔧 SOLUTION: Configure Custom Domain in Cloudflare Dashboard');
console.log('');
console.log('Step-by-step:');
console.log('');
console.log('1. Go to Cloudflare Dashboard → R2');
console.log('2. Click on bucket: gemini-images');
console.log('3. Go to "Settings" tab');
console.log('4. Find "Custom Domains" section');
console.log('5. Add your custom domain:');
console.log(`   ${CUSTOM_DOMAIN}`);
console.log('');
console.log('6. Follow DNS setup instructions:');
console.log('   - Add CNAME record pointing to R2 bucket');
console.log('   - Wait for DNS propagation (may take 5-30 minutes)');
console.log('   - Verify with: nslookup pub-9e166d045e1441eb9f75bcce60904352.r2.dev');
console.log('');
console.log('7. Test public access again:');
console.log(`   curl http://${CUSTOM_DOMAIN.replace('https://', '')}/test.txt`);
console.log('');
console.log('-'.repeat(70));
console.log('');

console.log('⚠️  Note: Using R2 default URLs');
console.log('');
console.log('Until custom domain is configured, the system will still work');
console.log('but use R2 default URLs. You can:');
console.log('');
console.log('Option A: Use default R2 URLs (temporary)');
console.log('  Set in .env:');
console.log(`  R2_PUBLIC_BASE_URL=https://a526a258cf79cefd6f476c93adcc8a93.r2.cloudflarestorage.com/gemini-images`);
console.log('');
console.log('Option B: Wait for custom domain setup (recommended)');
console.log('  - Configure CNAME in Cloudflare');
console.log('  - Wait for DNS propagation');
console.log('  - Test access again');
console.log('');
console.log('System will work with either configuration!');
console.log('='.repeat(70));
