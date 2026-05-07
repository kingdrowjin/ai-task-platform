const express = require('express');
const mongoose = require('mongoose');
const { isQueueHealthy } = require('../config/queue');

const router = express.Router();

router.get('/livez', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/readyz', async (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  const redisReady = await isQueueHealthy();
  const ready = dbReady && redisReady;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    db: dbReady,
    redis: redisReady,
  });
});

module.exports = router;
