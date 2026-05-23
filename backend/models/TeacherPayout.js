const mongoose = require('mongoose');

/**
 * บันทึกการชำระค่าจ้างสอนให้ครู (1 record ต่อ ครู × เดือน)
 * ใช้สำหรับ track สถานะว่าครูคนนี้ในเดือนนั้นถูกชำระค่าจ้างแล้วหรือยัง
 */
const TeacherPayoutSchema = new mongoose.Schema({
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // เดือนที่ชำระ format 'YYYY-MM'
  month: {
    type: String,
    required: true,
    index: true,
    match: /^\d{4}-\d{2}$/
  },
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  paidAt: {
    type: Date,
    default: Date.now
  }
});

// กันชำระซ้ำในเดือนเดียวกัน (1 ครู ต่อ 1 เดือน)
TeacherPayoutSchema.index({ teacher: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('TeacherPayout', TeacherPayoutSchema);
