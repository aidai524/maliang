#!/usr/bin/env node
/**
 * 测试火山方舟即梦AI API
 */

const API_KEY = '620dd2b6-b103-4d64-b50c-62f77f0efd52';
const MODEL = 'doubao-seedream-4-0-250828';
const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

async function main() {
  console.log('===== 测试火山方舟即梦AI API =====\n');
  
  const requestBody = {
    model: MODEL,
    prompt: 'A cute cat wearing a red hat',
    size: '2K',
    n: 1,
    response_format: 'url',
  };

  console.log('请求配置:');
  console.log('URL:', `${BASE_URL}/images/generations`);
  console.log('Model:', MODEL);
  console.log('Prompt:', requestBody.prompt);
  console.log('\n正在调用API...\n');

  try {
    const response = await fetch(`${BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('响应状态:', response.status);
    
    const data = await response.json();
    console.log('响应内容:', JSON.stringify(data, null, 2));

    if (data.data && data.data.length > 0) {
      console.log('\n✅ 成功！生成了', data.data.length, '张图片');
      data.data.forEach((img, i) => {
        console.log(`图片 ${i + 1}:`, img.url || '(base64 data)');
      });
    } else if (data.error) {
      console.log('\n❌ API返回错误:', data.error.message);
    }
  } catch (error) {
    console.error('请求失败:', error.message);
  }
}

main();
