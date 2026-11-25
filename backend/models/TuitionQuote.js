const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;
const schema = new mongoose.Schema({
  student: { type: ObjectId, ref: 'User', required: true },
  schedule: { type: ObjectId, ref: 'Schedule' },
  month: String,
  promptpayId: String,
  items: [{
    _id: false,
    schedule: { type: ObjectId, ref: 'Schedule', required: true },
    course: { type: ObjectId, ref: 'Course', required: true },
    amount: { type: Number, required: true }
  }],
  paymentIds: [{ type: ObjectId, ref: 'Payment' }],
  createdAt: { type: Date, default: Date.now }
});

schema.index({ student: 1, schedule: 1, month: 1, createdAt: -1 });

module.exports = mongoose.model('TuitionQuote', schema);
