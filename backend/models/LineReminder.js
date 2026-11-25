const mongoose = require('mongoose');

const runSchema = new mongoose.Schema({
  _id: String,
  owner: String,
  lockedUntil: Date,
  quotaExceededAt: Date
});

const deliverySchema = new mongoose.Schema({
  _id: String,
  round: { type: String, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recipient: String,
  uri: String,
  retryKey: String,
  firstAttemptAt: Date,
  nextAttemptAt: Date,
  attempts: { type: Number, default: 0 },
  status: { type: String, enum: ['retry', 'accepted', 'failed', 'skipped'] },
  reason: String
});

module.exports = {
  LineReminderRun: mongoose.model('LineReminderRun', runSchema),
  LineReminderDelivery: mongoose.model('LineReminderDelivery', deliverySchema)
};
