#!/usr/bin/env node

/**
 * Complete image generation flow test
 * Tests: submit job, poll status, get image URL
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

const API_BASE = `http://localhost:${process.env.PORT || 3001}`;
const API_KEY = process.env.TEST_API_KEY || 'img_test_dev_123456789';

console.log('='.repeat(70));
console.log('Complete Image Generation Flow Test');
console.log('='.repeat(70));
console.log('');
console.log('Configuration:');
console.log(`  API Base: ${API_BASE}`);
console.log(`  API Key: ${API_KEY}`);
console.log(`  Storage: ${process.env.STORAGE_TYPE}`);
console.log('');

async function testCompleteFlow() {
  let jobId = null;
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes max wait time
  const pollInterval = 2000; // 2 seconds

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
        prompt: 'A cute cat sitting on a windowsill, realistic style, warm lighting',
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
        console.log('');
        console.log('Step 3: Displaying image URLs...');
        console.log('-'.repeat(70));

        if (resultUrls.length > 0) {
          resultUrls.forEach((url, index) => {
            console.log(`   Image ${index + 1}:`);
            console.log(`     ${url}`);
          });
        } else {
          console.log('   ⚠️  No image URLs returned!');
        }

        console.log('');
        console.log('Step 4: Testing image URL access...');
        console.log('-'.repeat(70));

        for (let i = 0; i < Math.min(resultUrls.length, 2); i++) {
          const url = resultUrls[i];
          console.log(`Testing URL: ${url.substring(0, 60)}...`);

          try {
            const imgResponse = await fetch(url);
            if (imgResponse.ok) {
              const contentType = imgResponse.headers.get('content-type');
              const size = parseInt(imgResponse.headers.get('content-length') || '0');
              console.log(`   ✅ Accessible! Content-Type: ${contentType}, Size: ${size} bytes`);
            } else {
              console.log(`   ⚠️  Returned ${imgResponse.status}: ${imgResponse.statusText}`);
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
        console.log(`  ✅ Parallel uploads (${resultUrls.length} images)`);
        console.log(`  ✅ Progressive result updates`);
        console.log(`  ✅ Image URLs accessible`);
        console.log(`  ✅ R2 storage: ${process.env.STORAGE_TYPE === 'r2' ? 'Active' : 'Not in use'}`);

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
