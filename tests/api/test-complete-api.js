#!/usr/bin/env node

const API_BASE = 'http://localhost:3001';
const API_KEY = 'img_test_dev_123456789';

async function testHealth() {
  console.log('🔍 Testing /health endpoint...\n');
  
  const response = await fetch(`${API_BASE}/health`);
  const data = await response.json();
  
  console.log(`Status: ${response.status}`);
  console.log(`Response: ${JSON.stringify(data, null, 2)}\n`);
  
  return response.ok;
}

async function testGenerateImage() {
  console.log('📸 Testing POST /v1/images/generate...\n');
  
  const response = await fetch(`${API_BASE}/v1/images/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: 'A beautiful sunset over the ocean',
      mode: 'draft',
    }),
  });
  
  const data = await response.json();
  
  console.log(`Status: ${response.status}`);
  console.log(`Response: ${JSON.stringify(data, null, 2)}\n`);
  
  if (response.ok && data.jobId) {
    return data.jobId;
  }
  
  return null;
}

async function testGetJob(jobId) {
  console.log(`🔍 Testing GET /v1/jobs/${jobId}...\n`);
  
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  });
  
  const data = await response.json();
  
  console.log(`Status: ${response.status}`);
  console.log(`Status: ${data.status}`);
  console.log(`Result URLs: ${data.resultUrls?.length || 0}`);
  if (data.resultUrls?.length > 0) {
    console.log(`First URL: ${data.resultUrls[0].substring(0, 80)}...`);
  }
  console.log(`Created At: ${data.createdAt}\n`);
  
  return response.ok ? data : null;
}

async function testListJobs() {
  console.log('📋 Testing GET /v1/jobs...\n');
  
  const response = await fetch(`${API_BASE}/v1/jobs`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  });
  
  const data = await response.json();
  
  console.log(`Status: ${response.status}`);
  console.log(`Total jobs: ${data.items?.length || 0}`);
  if (data.items?.length > 0) {
    console.log('Recent jobs:');
    data.items.slice(0, 5).forEach(job => {
      console.log(`  - ${job.id}: ${job.status}`);
    });
  }
  console.log('');
  
  return response.ok ? data : null;
}

async function testCancelJob(jobId) {
  console.log(`🚫 Testing DELETE /v1/jobs/${jobId}...\n`);
  
  const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
    },
  });
  
  const data = await response.json();
  
  console.log(`Status: ${response.status}`);
  console.log(`Response: ${JSON.stringify(data, null, 2)}\n`);
  
  return response.ok;
}

async function waitForJobCompletion(jobId, maxAttempts = 10, intervalMs = 2000) {
  console.log(`⏳ Waiting for job ${jobId} to complete...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
    });
    
    const data = await response.json();
    
    if (data.status === 'SUCCEEDED' || data.status === 'FAILED' || data.status === 'CANCELED') {
      console.log(`✅ Job completed with status: ${data.status}\n`);
      return data;
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  console.log(`⚠️  Job did not complete within ${maxAttempts * intervalMs / 1000}s\n`);
  return null;
}

async function main() {
  console.log('═════════════════════════════════════════════════════════');
  console.log('🧪 Complete API Interface Test');
  console.log('═════════════════════════════════════════════════════════\n');
  console.log(`API Base: ${API_BASE}`);
  console.log(`API Key: ${API_KEY}\n`);
  
  const results = {
    health: false,
    generate: false,
    listJobs: false,
    getJobPending: false,
    getJobCompleted: false,
    cancelJob: false,
  };
  
  // Test 1: Health check
  try {
    results.health = await testHealth();
  } catch (error) {
    console.error('❌ Health check failed:', error.message, '\n');
  }
  
  // Test 2: Generate image
  let jobId = null;
  try {
    jobId = await testGenerateImage();
    results.generate = !!jobId;
  } catch (error) {
    console.error('❌ Generate image failed:', error.message, '\n');
  }
  
  // Test 3: List jobs
  try {
    results.listJobs = await testListJobs();
  } catch (error) {
    console.error('❌ List jobs failed:', error.message, '\n');
  }
  
  // Test 4: Get job while pending/running
  if (jobId) {
    try {
      results.getJobPending = await testGetJob(jobId);
    } catch (error) {
      console.error('❌ Get job (pending) failed:', error.message, '\n');
    }
  }
  
  // Test 5: Wait for completion and get job again
  if (jobId) {
    try {
      const completed = await waitForJobCompletion(jobId, 15, 2000);
      results.getJobCompleted = !!completed;
      
      if (completed) {
        console.log('📊 Final job status:');
        console.log(`   Status: ${completed.status}`);
        console.log(`   Images generated: ${completed.resultUrls?.length || 0}\n`);
      }
    } catch (error) {
      console.error('❌ Wait for job failed:', error.message, '\n');
    }
  }
  
  // Test 6: Cancel a new job (create a new one and cancel immediately)
  let cancelJobId = null;
  try {
    console.log('📸 Creating new job for cancellation test...\n');
    
    const response = await fetch(`${API_BASE}/v1/images/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'A test image for cancellation',
        mode: 'draft',
      }),
    });
    
    const data = await response.json();
    
    if (response.ok && data.jobId) {
      cancelJobId = data.jobId;
      console.log(`Job created: ${cancelJobId}\n`);
      
      // Cancel immediately
      results.cancelJob = await testCancelJob(cancelJobId);
    }
  } catch (error) {
    console.error('❌ Cancel job test failed:', error.message, '\n');
  }
  
  // Summary
  console.log('═════════════════════════════════════════════════════════');
  console.log('📊 Test Summary');
  console.log('═════════════════════════════════════════════════════════\n');
  
  console.log(`Health Check:           ${results.health ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Generate Image:         ${results.generate ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`List Jobs:              ${results.listJobs ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Get Job (Pending):      ${results.getJobPending ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Get Job (Completed):    ${results.getJobCompleted ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Cancel Job:             ${results.cancelJob ? '✅ PASS' : '❌ FAIL'}`);
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  console.log(`\nTotal: ${passed}/${total} tests passed\n`);
  
  process.exit(passed === total ? 0 : 1);
}

main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});