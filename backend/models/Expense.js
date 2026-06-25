const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
    trim: true
  },
  // ประเภทรายการ — 'income' = รายรับเพิ่มเติม, 'expense' = รายจ่าย
  type: {
    type: String,
    enum: ['income', 'expense'],
    default: 'expense'
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  // หมวดรายจ่าย (เฉพาะ type='expense') — 'personnel' = รายจ่ายบุคลากร (ผูกกับครู/manager/admin),
  // 'other' = อื่นๆ. income ไม่ใช้ field นี้ (เป็น null)
  category: {
    type: String,
    enum: ['personnel', 'other'],
    default: null
  },
  // บุคลากรที่ผูกรายจ่ายนี้ (เมื่อ category='personnel') — ใช้บวกเข้า KPI รายจ่ายครูของคนนั้น
  personId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // ชื่อ/ชื่อเล่นบุคลากร ณ ตอนบันทึก (denormalized) — ใช้แสดงการ์ดแม้ผู้ใช้ไม่อยู่ใน list ที่โหลด
  personName: {
    type: String,
    default: '',
    trim: true
  },
  // หมายเหตุเพิ่มเติม (จาก checkbox 'อื่นๆ') — ไม่บังคับ
  note: {
    type: String,
    default: '',
    trim: true
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
