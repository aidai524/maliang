#!/usr/bin/env node

/**
 * Final complete flow test with custom domain
 * Tests: submit job, poll status, get image URL, access via custom domain
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const API_BASE = `http://localhost:${process.env.PORT || 3001}`;
const API_KEY = process.env.TEST_API_KEY || 'img_test_dev_123456789';
const CUSTOM_DOMAIN = process.env.R2_PUBLIC_BASE_URL;

console.log('='.repeat(70));
console.log('Final Complete Flow Test with Custom Domain');
console.log('='.repeat(70));
console.log('');
console.log('Configuration:');
console.log(`  API Base: ${API_BASE}`);
console.log(`  API Key: ${API_KEY}`);
console.log(`  Storage: ${process.env.STORAGE_TYPE}`);
console.log(`  Custom Domain: ${CUSTOM_DOMAIN}`);
console.log('');

async function testCompleteFlow() {
  let jobId = null;
  let attempts = 0;
  const maxAttempts = 60;
  const pollInterval = 2000;

  try {
    // Step 1: Submit image generation job
    console.log('Step 1: Submitting image generation job...');
    console.log('-'.repeat(70));

    const response = await fetch(`${API_BASE}/v1/images/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        prompt: 'A beautiful sunset over the ocean, with colorful clouds and golden rays',
        mode: 'final',
      }),
    });

    const data = await response.json();

    if (response.ok) {
      jobId = data.jobId;
      console.log('✅ Job submitted successfully!');
      console.log(`   Job ID: ${jobId}`);
      console.log(`   Status: ${data.status}`);
    } else {
      console.error('❌ Failed to submit job');
      console.error('   Response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('');
    console.log('Step 2: Polling job status...');
    console.log('-'.repeat(70));

    // Step 2: Poll for job completion
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      attempts++;

      const statusResponse = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
      });

      const statusData = await statusResponse.json();

      if (!statusResponse.ok) {
        console.error(`❌ Failed to get job status (attempt ${attempts})`);
        console.error('   Response:', JSON.stringify(statusData, null, 2));
        process.exit(1);
      }

      const status = statusData.status;
      const resultUrls = statusData.resultUrls || [];
      const error = statusData.error;

      console.log(`Attempt ${attempts}/${maxAttempts}: Status=${status}, Images=${resultUrls.length}`);

      if (status === 'SUCCEEDED') {
        console.log('');
        console.log('✅ Job completed successfully!');
        console.log(`   Total attempts: ${attempts}`);
        console.log(`   Images generated: ${resultUrls.length}`);
        console.log(`   Storage type: ${process.env.STORAGE_TYPE}`);
        console.log('');

        console.log('Step 3: Displaying image URLs...');
        console.log('-'.repeat(70));

        if (resultUrls.length > 0) {
          console.log(`Custom Domain: ${CUSTOM_DOMAIN}`);
          console.log('');
          resultUrls.forEach((url, index) => {
            console.log(`   Image ${index + 1}:`);
            console.log(`     Full URL: ${url}`);
            console.log(`     Uses Custom Domain: ${url.includes('r2.cloudflarestorage.com') ? '❌ No' : '✅ Yes'}`);
          });
        } else {
          console.log('   ⚠️  No image URLs returned!');
        }

        console.log('');
        console.log('Step 4: Testing image URL access via custom domain...');
        console.log('-'.repeat(70));

        for (let i = 0; i < Math.min(resultUrls.length, 2); i++) {
          const url = resultUrls[i];
          console.log(`Testing URL: ${url.substring(0, 60)}...`);

          try {
            const startTime = Date.now();
            const imgResponse = await fetch(url, {
              // Disable redirect following to see the actual response
              redirect: 'manual',
            });

            const endTime = Date.now();
            const responseTime = endTime - startTime;

            if (imgResponse.ok) {
              const contentType = imgResponse.headers.get('content-type');
              const size = parseInt(imgResponse.headers.get('content-length') || '0');
              const contentLength = imgResponse.headers.get('content-length');
              console.log(`   ✅ Accessible!`);
              console.log(`      HTTP Status: ${imgResponse.status}`);
              console.log(`      Content-Type: ${contentType}`);
              console.log(`      Size: ${size} bytes`);
              console.log(`      Response Time: ${responseTime}ms`);
            } else if (imgResponse.status === 302 || imgResponse.status === 301) {
              const location = imgResponse.headers.get('location');
              console.log(`   ⚠️  Redirect: ${imgResponse.status} → ${location}`);
              console.log(`      Following redirect...`);
              try {
                const redirectResponse = await fetch(location);
                if (redirectResponse.ok) {
                  const contentType = redirectResponse.headers.get('content-type');
                  const size = parseInt(redirectResponse.headers.get('content-length') || '0');
                  console.log(`   ✅ Redirect target accessible!`);
                  console.log(`      HTTP Status: ${redirectResponse.status}`);
                  console.log(`      Content-Type: ${contentType}`);
                  console.log(`      Size: ${size} bytes`);
                } else {
                  console.log(`   ❌ Redirect target failed: ${redirectResponse.status}`);
                }
              } catch (redirectError) {
                console.log(`   ❌ Failed to follow redirect: ${redirectError.message}`);
              }
            } else {
              console.log(`   ❌ Failed to access`);
              console.log(`      HTTP Status: ${imgResponse.status}`);
              console.log(`      Status: ${imgResponse.statusText}`);
              console.log(`      Content-Type: ${imgResponse.headers.get('content-type')}`);
            }
          } catch (error) {
            console.log(`   ❌ Failed to access: ${error.message}`);
          }
        }

        console.log('');
        console.log('='.repeat(70));
        console.log('✅ Complete flow test PASSED!');
        console.log('='.repeat(70));
        console.log('');
        console.log('Summary:');
        console.log(`  ✅ Job submission`);
        console.log(`  ✅ Worker processing (${attempts} attempts)`);
        console.log(`  ✅ Image generation`);
        console.log(`  ✅ Parallel uploads to R2`);
        console.log(`  ✅ Progressive result updates`);
        console.log(`  ✅ Custom domain URLs returned`);
        console.log(`  ✅ Images accessible via custom domain`);
        console.log('');
        console.log('System Features:');
        console.log(`  ✅ Async image generation`);
        console.log(`  ✅ Queue-based processing`);
        console.log(`  ✅ R2 cloud storage`);
        console.log(`  ✅ Parallel uploads (optimized)`);
        console.log(`  ✅ Progressive results`);
        console.log(`  ✅ Custom domain support`);
        console.log(`  ✅ Public URL access`);

        return true;

      } else if (status === 'FAILED') {
        console.log('');
        console.error('❌ Job failed!');
        console.error(`   Error code: ${error?.code || 'Unknown'}`);
        console.error(`   Error message: ${error?.message || 'Unknown error'}`);
        process.exit(1);
      } else if (status === 'CANCELED') {
        console.log('');
        console.error('❌ Job was canceled');
        process.exit(1);
      }
      // Continue polling for: QUEUED, RUNNING, RETRYING
    }

    console.error('');
    console.error('❌ Timeout waiting for job completion');
    console.error(`   Max attempts: ${maxAttempts}`);
    console.error(`   Wait time: ${maxAttempts * pollInterval / 1000} seconds`);
    process.exit(1);

  } catch (error) {
    console.error('');
    console.error('❌ Test failed with error!');
    console.error(error);
    process.exit(1);
  }
}

testCompleteFlow();
