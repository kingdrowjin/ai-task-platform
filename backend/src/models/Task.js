const mongoose = require('mongoose');

const OPERATIONS = ['uppercase', 'lowercase', 'reverse', 'word_count'];
const STATUSES = ['pending', 'running', 'success', 'failed'];

const taskSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    input: { type: String, required: true, maxlength: 10000 },
    operation: { type: String, required: true, enum: OPERATIONS },
    status: { type: String, required: true, enum: STATUSES, default: 'pending', index: true },
    result: { type: String, default: null },
    logs: { type: [String], default: [] },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

taskSchema.index({ user: 1, createdAt: -1 });
taskSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Task', taskSchema);
module.exports.OPERATIONS = OPERATIONS;
module.exports.STATUSES = STATUSES;
