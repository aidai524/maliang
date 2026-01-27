import { createLogger } from '../utils/logger';
import { prisma } from '../db/prisma';
import { redis } from '../queue/redis';
import type { PickedKey } from './keypool.service';

const logger = createLogger('monitoring');

export interface AlertConfig {
  threshold503Rate: number; // 503错误率阈值，超过后发送告警
  thresholdFailureRate: number; // 总失败率阈值
  alertEndpoint?: string; // 告警webhook地址
  alertEmail?: string; // 告警邮件
}

export interface MonitoringStats {
  periodMs: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  total503Errors: number;
  totalKeyFailures: number;
  requestsInLastPeriod: number;
}

let stats: MonitoringStats = {
  periodMs: 60 * 1000, // 1分钟
  totalRequests: 0,
  totalSuccesses: 0,
  totalFailures: 0,
  total503Errors: 0,
  totalKeyFailures: 0,
  requestsInLastPeriod: 0,
};

/**
 * 记录API请求到监控统计
 */
export function recordRequest(success: boolean, is503Error: boolean = false): void {
  stats.totalRequests++;
  stats.requestsInLastPeriod++;

  if (success) {
    stats.totalSuccesses++;
  } else {
    stats.totalFailures++;
    
    if (is503Error) {
      stats.total503Errors++;
      logger.warn('503 error recorded', {
        current503Rate: get503ErrorRate(),
      total503Errors: stats.total503Errors,
      totalRequests: stats.totalRequests,
      });
    }
  }

  // 如果超过告警阈值，触发告警
  checkAndSendAlert();
}

/**
 * 检查并发送告警
 */
function checkAndSendAlert(): void {
  const config = getAlertConfig();
  
  const current503Rate = get503ErrorRate();
  const currentFailureRate = stats.totalFailures / stats.totalRequests;
  
  let shouldAlert = false;
  let alertMessage = '';
  
  if (current503Rate >= config.threshold503Rate) {
    shouldAlert = true;
    alertMessage = `503错误率 ${current503Rate.toFixed(1)}% 超过阈值`;
  } else if (currentFailureRate >= config.thresholdFailureRate) {
    shouldAlert = true;
    alertMessage = `总失败率 ${currentFailureRate.toFixed(1)}% 超过阈值`;
  }
  
  if (shouldAlert) {
    logger.error('Alert threshold exceeded', {
      alertMessage,
      current503Rate,
      currentFailureRate,
      config,
      stats,
    });
    
    // 发送webhook告警（如果配置了）
    if (config.alertEndpoint) {
      sendWebhookAlert(config.alertEndpoint, alertMessage, stats);
    }

    // 发送邮件告警（如果配置了）
    if (config.alertEmail) {
      sendEmailAlert(config.alertEmail, alertMessage, stats);
    }
  }
  
  // 重置周期内的统计
  if (stats.requestsInLastPeriod >= 100) { // 每100个请求重置周期
    const oldTotal = stats.totalRequests;
    stats.requestsInLastPeriod = 0;
    logger.info('Resetting monitoring period stats', {
      periodRequests: oldTotal,
      totalSuccesses: stats.totalSuccesses,
      totalFailures: stats.totalFailures,
      total503Errors: stats.total503Errors,
    });
  }
}

/**
 * 获取503错误率
 */
function get503ErrorRate(): number {
  if (stats.totalRequests === 0) return 0;
  return (stats.total503Errors / stats.totalRequests) * 100;
}

/**
 * 获取告警配置
 */
function getAlertConfig(): AlertConfig {
  return {
    threshold503Rate: Number(process.env.ALERT_503_RATE || '30'), // 30%的503错误率告警
    thresholdFailureRate: Number(process.env.ALERT_FAILURE_RATE || '50'), // 50%的总失败率告警
    alertEndpoint: process.env.ALERT_WEBHOOK_ENDPOINT || '',
    alertEmail: process.env.ALERT_EMAIL || '',
  };
}

/**
 * 发送webhook告警
 */
async function sendWebhookAlert(endpoint: string, message: string, stats: MonitoringStats): Promise<void> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ImageSaaS Monitoring',
      },
      body: JSON.stringify({
        message,
        timestamp: new Date().toISOString(),
        stats: {
          totalRequests: stats.totalRequests,
          totalSuccesses: stats.totalSuccesses,
          totalFailures: stats.totalFailures,
          total503Errors: stats.total503Errors,
          current503Rate: get503ErrorRate(),
          currentFailureRate: stats.totalRequests > 0 ? (stats.totalFailures / stats.totalRequests) * 100 : 0,
        },
      }),
    });
    
    logger.info('Alert webhook sent', { endpoint, message });
  } catch (error: any) {
    logger.error('Failed to send alert webhook', { error: error?.message || String(error) });
  }
}

/**
 * 发送邮件告警
 */
async function sendEmailAlert(email: string, message: string, stats: MonitoringStats): Promise<void> {
  logger.info('Email alert (simulated)', { email, message, stats });
  // TODO: 实现实际邮件发送功能
}

/**
 * 获取监控统计（用于健康检查和告警）
 */
export function getMonitoringStats(): MonitoringStats & {
  canContinue: boolean;
  current503Rate: number;
  currentFailureRate: number;
} {
  const current503Rate = get503ErrorRate();
  const currentFailureRate = stats.totalRequests > 0 ? (stats.totalFailures / stats.totalRequests) * 100 : 0;

  return {
    ...stats,
    current503Rate,
    currentFailureRate,
    canContinue: current503Rate < 30, // 如果503错误率超过30%，停止接受新请求
  };
}

/**
 * 重置统计（用于测试或每小时重置）
 */
export function resetMonitoringStats(): void {
  const oldTotal = stats.totalRequests;
  
  stats = {
    periodMs: 60 * 1000,
    totalRequests: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    total503Errors: 0,
    totalKeyFailures: 0,
    requestsInLastPeriod: 0,
  };
  
  logger.info('Monitoring stats reset', {
    periodRequests: oldTotal,
    newPeriodRequests: stats.totalRequests,
  });
}
