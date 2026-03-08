import 'dotenv/config';
import { geminiGenerate } from '../src/providers/gemini/client';
import { putImage } from '../src/services/storage.service';
import { config } from '../src/config/env';
import type { GeminiStatusResult } from '../src/providers/gemini/types';

async function testGemini31() {
  console.log('\n========================================');
  console.log('Gemini 3.1 Flash Image Preview 测试');
  console.log('========================================\n');

  const apiKey = config.gemini.apiKey1 || process.env.GEMINI_API_KEY_1;
  
  if (!apiKey) {
    console.log('❌ 未找到 Gemini API Key');
    console.log('请在 .env 中配置 GEMINI_API_KEY_1\n');
    process.exit(1);
  }

  console.log('📦 测试配置:');
  console.log(`   Model: gemini-3.1-flash-image-preview`);
  console.log(`   Storage: ${config.storage.type}`);
  if (config.oss) {
    console.log(`   OSS Bucket: ${config.oss.bucket}`);
  }
  console.log('');

  const testPrompt = 'A cute orange cat wearing a tiny hat, sitting on a windowsill, soft sunlight, realistic style';
  
  console.log('🎨 测试提示词:');
  console.log(`   "${testPrompt}"\n`);

  console.log('🚀 调用 Gemini API...\n');
  
  try {
    let result: (GeminiStatusResult & { status: 'SUCCEEDED' | 'FAILED'; model?: string; endpoint?: string }) | null = null;
    let usedModel = '';
    
    try {
      result = await geminiGenerate({
        apiKey,
        prompt: testPrompt,
        model: 'gemini-3.1-flash-image-preview',
        resolution: '1K',
        aspectRatio: '1:1',
        endpoint: 'official',
      }, {
        maxAttempts: 60,
        intervalMs: 3000,
        enableFallback: false,
      });
      usedModel = 'gemini-3.1-flash-image-preview';
    } catch (error: any) {
      console.log('   ⚠️  Gemini 3.1 不可用，回退到 gemini-2.0-flash-exp\n');
      console.log(`   错误: ${error.message}\n`);
      
      result = await geminiGenerate({
        apiKey,
        prompt: testPrompt,
        model: 'gemini-2.0-flash-exp-image-generation',
        resolution: '1K',
        aspectRatio: '1:1',
        endpoint: 'official',
      }, {
        maxAttempts: 60,
        intervalMs: 3000,
        enableFallback: false,
      });
      usedModel = 'gemini-2.0-flash-exp-image-generation';
    }

    if (!result) {
      console.log('❌ 未获取到结果');
      process.exit(1);
    }

    if (result.status === 'FAILED') {
      console.log('❌ 生成失败:', result.error);
      process.exit(1);
    }

    console.log(`✅ 生成成功! 模型: ${usedModel}`);
    console.log(`   端点: ${result.endpoint}`);
    console.log(`   图片数量: ${result.images?.length || 0}\n`);

    if (!result.images || result.images.length === 0) {
      console.log('❌ 未生成图片');
      process.exit(1);
    }

    console.log('💾 上传图片到 OSS...\n');
    
    for (let i = 0; i < result.images.length; i++) {
      const image = result.images[i];
      
      if (!image.url.startsWith('data:')) {
        console.log(`   图片 ${i + 1}: 跳过 (非 base64)`);
        continue;
      }

      const [mimeType, base64Data] = image.url.split(';base64,');
      const buffer = Buffer.from(base64Data, 'base64');
      
      const stored = await putImage(buffer, {
        contentType: image.mimeType || mimeType.replace('data:', ''),
        filename: `gemini-3.1-test/${Date.now()}-${i}.png`,
      });

      console.log(`✅ 图片 ${i + 1} 已上传:`);
      console.log(`   Key: ${stored.key}`);
      console.log(`   URL: ${stored.url}`);
      console.log(`   Size: ${(buffer.length / 1024).toFixed(2)} KB\n`);
    }

    console.log('========================================');
    console.log('🎉 测试完成 - 所有功能正常!');
    console.log('========================================\n');
    
  } catch (error) {
    console.log('❌ 测试失败:', error);
    process.exit(1);
  }
}

testGemini31().catch((error) => {
  console.error('\n❌ 未预期的错误:', error);
  process.exit(1);
});
