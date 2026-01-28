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
      prompt: 'A cute cat sitting on a couch',
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
  console.log(`Response: ${JSON.stringify(data, null, 2)}\n`);
  
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
  console.log(`Response: ${JSON.stringify(data, null, 2)}\n`);
  
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

async function main() {
  console.log('═════════════════════════════════════════════════════════');
  console.log('🧪 API Interface Test');
  console.log('═════════════════════════════════════════════════════════\n');
  console.log(`API Base: ${API_BASE}`);
  console.log(`API Key: ${API_KEY}\n`);
  
  const results = {
    health: false,
    generate: false,
    getJob: false,
    listJobs: false,
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
  
  // Test 4: Get job status
  if (jobId) {
    try {
      // Wait a bit for job to be processed
      console.log('⏳ Waiting 2 seconds before checking job status...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      results.getJob = await testGetJob(jobId);
    } catch (error) {
      console.error('❌ Get job failed:', error.message, '\n');
    }
  }
  
  // Test 5: Cancel job (optional)
  if (jobId) {
    try {
      results.cancelJob = await testCancelJob(jobId);
    } catch (error) {
      console.error('❌ Cancel job failed:', error.message, '\n');
    }
  }
  
  // Summary
  console.log('═════════════════════════════════════════════════════════');
  console.log('📊 Test Summary');
  console.log('═════════════════════════════════════════════════════════\n');
  
  console.log(`Health Check:       ${results.health ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Generate Image:     ${results.generate ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`List Jobs:          ${results.listJobs ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Get Job:            ${results.getJob ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Cancel Job:         ${results.cancelJob ? '✅ PASS' : '❌ FAIL'}`);
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  console.log(`\nTotal: ${passed}/${total} tests passed\n`);
  
  process.exit(passed === total ? 0 : 1);
}

main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});