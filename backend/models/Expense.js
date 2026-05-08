const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // เดือนของรายจ่าย (YYYY-MM) — ใช้กรองให้ตรงกับ filter ของหน้า revenue
  month: {
    type: String,
    required: true,
    match: /^\d{4}-\d{2}$/
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

ExpenseSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

ExpenseSchema.index({ month: 1, createdAt: -1 });

module.exports = mongoose.model('Expense', ExpenseSchema);
