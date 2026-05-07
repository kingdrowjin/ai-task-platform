const IORedis = require('ioredis');
const env = require('./env');

const QUEUE_KEY = 'tasks:queue';

const connection = new IORedis({
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

connection.on('error', (err) => {
  console.error('[redis] error:', err.message);
});
connection.on('connect', () => console.log('[redis] connected'));

async function enqueue(payload) {
  await connection.lpush(QUEUE_KEY, JSON.stringify(payload));
}

async function isQueueHealthy() {
  try {
    const pong = await connection.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

module.exports = { connection, enqueue, isQueueHealthy, QUEUE_KEY };
