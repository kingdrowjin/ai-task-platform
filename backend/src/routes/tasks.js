const express = require('express');
const Joi = require('joi');
const Task = require('../models/Task');
const { OPERATIONS } = require('../models/Task');
const { authRequired } = require('../middleware/auth');
const { enqueue } = require('../config/queue');

const router = express.Router();

const createSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
  input: Joi.string().min(1).max(10000).required(),
  operation: Joi.string().valid(...OPERATIONS).required(),
});

router.use(authRequired);

router.post('/', async (req, res, next) => {
  try {
    const { value, error } = createSchema.validate(req.body);
    if (error) return res.status(400).json({ error: 'invalid_input', message: error.message });

    const task = await Task.create({
      user: req.user.id,
      title: value.title,
      input: value.input,
      operation: value.operation,
      status: 'pending',
      logs: ['Task queued'],
    });

    await enqueue({ taskId: task.id, enqueuedAt: Date.now() });

    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const tasks = await Task.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.id, user: req.user.id }).lean();
    if (!task) return res.status(404).json({ error: 'not_found' });
    res.json(task);
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'not_found' });
    next(err);
  }
});

module.exports = router;
