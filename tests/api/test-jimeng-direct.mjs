#!/usr/bin/env node
/**
 * 直接测试即梦AI (火山引擎) API
 */

import 'dotenv/config';
import crypto from 'crypto';

const ACCESS_KEY_ID = process.env.JIMENG_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.JIMENG_SECRET_ACCESS_KEY;
const REGION = 'cn-north-1';
const SERVICE_NAME = 'cv';
const VERSION = '2022-08-31';  // 尝试不同版本

console.log('🔑 Credentials:');
console.log(`  Access Key ID: ${ACCESS_KEY_ID?.substring(0, 20)}...`);
console.log(`  Secret Access Key: ${SECRET_ACCESS_KEY?.substring(0, 20)}...`);
console.log('');

// 签名工具函数
function hmac(secret, s) {
  return crypto.createHmac('sha256', secret).update(s, 'utf8').digest();
}

function hash(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function queryParamsToString(params) {
  return Object.keys(params)
    .sort()
    .map(key => {
      const val = params[key];
      if (val === undefined || val === null) return undefined;
      return `${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`;
    })
    .filter(v => v)
    .join('&');
}

function getSignHeaders(originHeaders) {
  const ignoreSet = new Set(['authorization', 'content-type', 'content-length', 'user-agent']);
  let h = Object.keys(originHeaders).filter(k => !ignoreSet.has(k.toLowerCase()));
  
  const signedHeaderKeys = h.map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = h
    .sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)
    .map(k => `${k.toLowerCase()}:${originHeaders[k].toString().trim().replace(/\s+/g, ' ')}`)
    .join('\n');
  
  return [signedHeaderKeys, canonicalHeaders];
}

function sign(params) {
  const { headers, query, region, serviceName, method, pathName = '/', accessKeyId, secretAccessKey, body } = params;
  
  const datetime = headers['X-Date'];
  const date = datetime.substring(0, 8);
  
  const [signedHeaders, canonicalHeaders] = getSignHeaders(headers);
  const bodySha = body ? hash(body) : hash('');
  
  const canonicalRequest = [
    method.toUpperCase(),
    pathName,
    queryParamsToString(query) || '',
    `${canonicalHeaders}\n`,
    signedHeaders,
    bodySha,
  ].join('\n');
  
  const credentialScope = [date, region, serviceName, 'request'].join('/');
  const stringToSign = ['HMAC-SHA256', datetime, credentialScope, hash(canonicalRequest)].join('\n');
  
  const kDate = hmac(secretAccessKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, serviceName);
  const kSigning = hmac(kService, 'request');
  const signature = hmac(kSigning, stringToSign).toString('hex');
  
  console.log('📝 Signature Details:');
  console.log(`  Datetime: ${datetime}`);
  console.log(`  Canonical Request Hash: ${hash(canonicalRequest).substring(0, 32)}...`);
  console.log(`  Credential Scope: ${credentialScope}`);
  console.log('');
  
  return `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function getDateTimeNow() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function testJimengAPI() {
  console.log('🚀 直接测试即梦API\n');
  
  const baseUrl = 'https://visual.volcengineapi.com';
  const action = 'CVSync2AsyncSubmitTask';
  
  const requestBody = {
    req_key: 'seedream_4.0_t2i_global',
    prompt: '一只可爱的熊猫',
    scale: '1024:1024',
    n: 1,
  };
  
  const datetime = getDateTimeNow();
  const bodyStr = JSON.stringify(requestBody);
  
  const headers = {
    'X-Date': datetime,
    'Host': 'visual.volcengineapi.com',
    'Content-Type': 'application/json',
  };
  
  const query = {
    Action: action,
    Version: VERSION,
  };
  
  const authorization = sign({
    method: 'POST',
    pathName: '/',
    headers,
    query,
    body: bodyStr,
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    serviceName: SERVICE_NAME,
    region: REGION,
  });
  
  const fullUrl = `${baseUrl}/?Action=${action}&Version=${VERSION}`;
  
  console.log('📤 Request:');
  console.log(`  URL: ${fullUrl}`);
  console.log(`  Body: ${bodyStr.substring(0, 100)}...`);
  console.log('');
  
  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Authorization': authorization,
      },
      body: bodyStr,
    });
    
    const responseText = await response.text();
    
    console.log('📥 Response:');
    console.log(`  Status: ${response.status}`);
    console.log(`  Body: ${responseText}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testJimengAPI();
