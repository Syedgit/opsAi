import { Queue, Worker } from 'bullmq';
import { logger } from '../utils/logger';
import { processMessageJob } from '../jobs/processMessage';

// Parse Redis connection from URL or use host/port
function getRedisConnection() {
  if (process.env.REDIS_URL) {
    // Parse Redis URL: redis://default:password@host:port
    const url = new URL(process.env.REDIS_URL);
    const connection: any = {
      host: url.hostname,
      port: parseInt(url.port || '6379'),
    };
    
    // Add authentication if present
    if (url.password) {
      connection.password = url.password;
    }
    if (url.username && url.username !== 'default') {
      connection.username = url.username;
    }
    
    // Upstash requires TLS - check if hostname contains 'upstash'
    if (url.hostname.includes('upstash')) {
      connection.tls = {};
    }
    
    return connection;
  }
  
  // Fallback to host/port
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  };
}

const redisConnection = getRedisConnection();

// Create queue
export const messageQueue = new Queue('message-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000,
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
});

// Create worker
export const messageWorker = new Worker(
  'message-processing',
  async (job) => {
    logger.info('Processing message job', { jobId: job.id, data: job.data });
    return await processMessageJob(job.data);
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process 5 messages concurrently
  }
);

messageWorker.on('completed', (job) => {
  logger.info('Message job completed', { jobId: job.id });
});

messageWorker.on('failed', (job, err) => {
  logger.error('Message job failed', {
    jobId: job?.id,
    error: err.message,
  });
});

/**
 * Add message to processing queue
 */
export async function queueMessage(data: {
  messageId: string;
  phoneE164: string;
  messageText?: string;
  mediaId?: string;
  mediaType?: string;
  storeId?: string; // Optional: pre-resolved store ID
}): Promise<void> {
  await messageQueue.add('process-message', data, {
    jobId: data.messageId, // Use messageId as jobId for idempotency
  });
  logger.info('Message queued', { messageId: data.messageId, storeId: data.storeId });
}

// Alias for backward compatibility
export const addToMessageQueue = queueMessage;

