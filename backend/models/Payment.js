const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  // ชำระต่อ schedule (คลาสเดียว) หรือ null = ชำระรวม
  schedule: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    default: null
  },
  // ชำระรายเดือน: เก็บ year/month ที่ชำระ
  paymentMonth: {
    type: String, // format: "YYYY-MM"
    default: null
  },
  // ประเภทการชำระ
  paymentType: {
    type: String,
    enum: ['per_class', 'monthly'],
    default: 'per_class'
  },
  amount: {
    type: Number,
    required: true
  },
  method: {
    type: String,
    enum: ['transfer', 'promptpay', 'credit_card', 'gateway'],
    required: true
  },
  slipImage: {
    type: String,
    default: null
  },
  transactionRef: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'rejected'],
    default: 'pending'
  },
  confirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  note: {
    type: String,
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

PaymentSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Payment', PaymentSchema);
