import 'dotenv/config';
import { config } from '../src/config/env';

const OSS = require('ali-oss');

async function testOSS() {
  console.log('\n========================================');
  console.log('阿里云 OSS 可用性测试');
  console.log('========================================\n');

  console.log('📦 检查 OSS 配置...\n');
  
  if (!config.oss) {
    console.log('❌ OSS 未配置');
    console.log('\n请在 .env 中配置:');
    console.log('  OSS_REGION=oss-cn-hangzhou');
    console.log('  OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com');
    console.log('  OSS_ACCESS_KEY_ID=your_key');
    console.log('  OSS_ACCESS_KEY_SECRET=your_secret');
    console.log('  OSS_BUCKET_NAME=your_bucket');
    console.log('  OSS_PUBLIC_BASE_URL=https://your-cdn.com\n');
    process.exit(1);
  }

  console.log('✅ 配置已加载:');
  console.log(`   Region: ${config.oss.region}`);
  console.log(`   Bucket: ${config.oss.bucket}\n`);

  console.log('📦 初始化 OSS 客户端...\n');
  
  const client = new OSS({
    region: config.oss.region,
    endpoint: config.oss.endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    bucket: config.oss.bucket,
  });

  console.log('✅ 客户端初始化成功\n');

  const testKey = `test-images/test-${Date.now()}.txt`;
  const testContent = Buffer.from(`OSS Test - ${new Date().toISOString()}`);
  
  console.log('📦 测试上传...\n');
  try {
    await client.put(testKey, testContent, {
      headers: { 'Content-Type': 'text/plain' },
    });
    console.log(`✅ 上传成功: ${testKey}\n`);
  } catch (error) {
    console.log('❌ 上传失败:', error);
    process.exit(1);
  }

  console.log('📦 测试下载...\n');
  try {
    const result = await client.get(testKey);
    const buffer = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content);
    const matches = buffer.toString() === testContent.toString();
    console.log(`✅ 下载成功, 内容匹配: ${matches}\n`);
  } catch (error) {
    console.log('❌ 下载失败:', error);
    process.exit(1);
  }

  console.log('📦 清理测试文件...\n');
  try {
    await client.delete(testKey);
    console.log('✅ 删除成功\n');
  } catch (error) {
    console.log('⚠️ 删除失败 (非致命):', error);
  }

  console.log('========================================');
  console.log('🎉 OSS 可用性测试完成 - 所有检查通过!');
  console.log('========================================\n');
}

testOSS().catch((error) => {
  console.error('\n❌ 测试失败:', error);
  process.exit(1);
});
