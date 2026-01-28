/**
 * 批量添加Gemini API Keys到数据库
 * 
 * 使用方法：
 * 1. 设置环境变量
 * 2. 运行此脚本
 * 
 * 环境变量格式：
 *   GEMINI_KEYS=KEY1,KEY2,KEY3,...
 * 
 * 或者在命令行指定：
 *   npm run add:keys -- "KEY1,KEY2,KEY3"
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

/**
 * 从环境变量或命令行参数读取Keys
 */
async function getGeminiKeys(): Promise<string[]> {
  // 从环境变量读取
  const envKeys = process.env.GEMINI_KEYS;
  
  if (envKeys) {
    console.log(`从环境变量读取 ${envKeys.split(',').length} 个Keys`);
    return envKeys.split(',').map(k => k.trim());
  }
  
  // 从命令行参数读取
  const cliKeys = process.argv.slice(2);
  
  if (cliKeys.length > 0) {
    console.log(`从命令行参数读取 ${cliKeys.length} 个Keys`);
    return cliKeys.join(',').split(',').map(k => k.trim());
  }
  
  console.error('未找到Gemini API Keys');
  console.log('');
  console.log('使用方法1：');
  console.log('  export GEMINI_KEYS="KEY1,KEY2,KEY3,KEY4,KEY5"');
  console.log('  npm run add:keys');
  console.log('');
  console.log('使用方法2：');
  console.log('  npm run add:keys -- "KEY1,KEY2,KEY3"');
  console.log('');
  console.log('API Key格式：');
  console.log('  - 以AIza开头的完整密钥');
  console.log('  - 示例：AIzaSyDIhaPvhZosl_Ekx8Pr6GwOpTEgr4rZc6o');
  process.exit(1);
}

/**
 * 验证API Key格式
 */
function validateApiKey(key: string): boolean {
  // Gemini API Key应该以AIza开头，长度约39个字符
  return key.startsWith('AIza') && key.length >= 39;
}

/**
 * 添加Keys到数据库
 */
async function addGeminiKeys(keys: string[]): Promise<void> {
  console.log(`准备添加 ${keys.length} 个Gemini API Keys...`);
  
  const validKeys = keys.filter(validateApiKey);
  const invalidKeys = keys.filter(k => !validateApiKey(k));
  
  if (invalidKeys.length > 0) {
    console.error(`发现 ${invalidKeys.length} 个无效的Keys，已跳过`);
    console.error('无效Keys:', invalidKeys);
  }
  
  if (validKeys.length === 0) {
    console.error('没有有效的Keys需要添加');
    process.exit(1);
  }
  
  console.log(`将添加 ${validKeys.length} 个有效的Keys到数据库`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const key of validKeys) {
    try {
      await prisma.providerKey.create({
        data: {
          provider: 'gemini',
          encryptedKey: key,
          rpmLimit: 60,
          concurrencyLimit: 2,
          enabled: true,
        },
      });
      
      successCount++;
      console.log(`✓ Key ${successCount}/${validKeys.length} 添加成功`);
    } catch (error: any) {
      errorCount++;
      console.error(`✗ Key ${errorCount}/${validKeys.length} 添加失败:`, error?.message || String(error));

      // 如果是唯一约束错误，跳过重复的key
      if (error?.message?.includes('Unique constraint')) {
        console.log('  (Key已存在，跳过)');
      }
    }
  }
  
  console.log('');
  console.log('完成！');
  console.log(`成功: ${successCount}, 失败: ${errorCount}`);
  console.log('');
  console.log('当前Provider Keys总数:', successCount);
  
  // 显示所有Keys
  const allKeys = await prisma.providerKey.findMany({
    where: { provider: 'gemini', enabled: true },
    orderBy: { createdAt: 'desc' },
  });
  
  console.log('');
  console.log('所有已启用的Gemini Keys:');
  console.log('');
  allKeys.forEach((key, index) => {
    const maskedKey = key.encryptedKey.slice(0, 8) + '...' + key.encryptedKey.slice(-8);
    console.log(`  ${index + 1}. ${maskedKey}`);
    console.log(`     RPM限制: ${key.rpmLimit}, 并发限制: ${key.concurrencyLimit}`);
  });
  
  process.exit(0);
}

async function main() {
  const keys = await getGeminiKeys();
  await addGeminiKeys(keys);
}

main().catch((error) => {
  console.error('执行失败:', error);
  process.exit(1);
});
