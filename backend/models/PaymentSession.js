const mongoose = require('mongoose');

/**
 * PaymentSession — เก็บ session การชำระเงินแต่ละครั้ง
 * ใช้สำหรับ:
 *  1. ติดตามสถานะ QR ที่สร้างแล้ว (pending → paid / failed / expired)
 *  2. จับคู่กับ KBank webhook ผ่าน `reference`
 *  3. ให้ frontend polling status
 */
const PaymentSessionSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    default: null
  },
  // schedules ที่ครอบคลุมในการชำระครั้งนี้ (1 หรือหลายคลาส)
  scheduleIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule'
  }],
  amount: {
    type: Number,
    required: true
  },
  paymentType: {
    type: String,
    enum: ['per_class', 'monthly'],
    default: 'per_class'
  },
  paymentMonth: {
    type: String,
    default: null
  },

  // ── Reference & Tracking ─────────────────────────────────────
  // reference ที่ใช้จับคู่กับ KBank webhook (unique ต่อ session)
  reference: {
    type: String,
    unique: true,
    required: true,
    index: true
  },

  // KBank transaction ID ที่ได้จาก webhook
  kbankTransactionId: {
    type: String,
    default: null
  },

  // QR code data URL สำหรับแสดงให้นักเรียน
  qrDataURL: {
    type: String,
    default: null
  },

  // ── Status ───────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'expired'],
    default: 'pending'
  },

  // ── Timestamps ───────────────────────────────────────────────
  expiresAt: {
    type: Date,
    // QR หมดอายุใน 15 นาที
    default: () => new Date(Date.now() + 15 * 60 * 1000)
  },
  paidAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-expire: ลบ document ที่ expired แล้ว 1 ชั่วโมงหลัง expiresAt
PaymentSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('PaymentSession', PaymentSessionSchema);
