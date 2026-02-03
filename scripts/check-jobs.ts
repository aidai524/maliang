#!/usr/bin/env ts-node
import { prisma } from '../src/db/prisma';

async function main() {
  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ['FAILED', 'QUEUED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      status: true,
      prompt: true,
      errorCode: true,
      errorMessage: true,
      attempts: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (jobs.length === 0) {
    console.log('✅ 没有失败或排队中的任务\n');
    return;
  }

  console.log(`\n📋 最近 ${jobs.length} 个失败/排队中的任务:\n`);

  jobs.forEach((job, index) => {
    console.log(`${index + 1}. Job ID: ${job.id}`);
    console.log(`   状态: ${job.status}`);
    console.log(`   Prompt: ${job.prompt.substring(0, 50)}...`);
    console.log(`   尝试次数: ${job.attempts}`);
    if (job.errorCode) {
      console.log(`   错误代码: ${job.errorCode}`);
      console.log(`   错误信息: ${job.errorMessage}`);
    }
    console.log(`   创建时间: ${job.createdAt.toLocaleString()}`);
    console.log(`   更新时间: ${job.updatedAt.toLocaleString()}`);
    console.log();
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
