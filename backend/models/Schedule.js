const mongoose = require('mongoose');

const StudentConfirmationSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending'
  },
  confirmedAt: {
    type: Date,
    default: null
  }
}, { _id: false });

const ScheduleSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  date: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  zoomLink: {
    type: String,
    default: null
  },
  room: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'scheduled', 'awaiting_confirmation', 'completed', 'cancelled'],
    default: 'pending'
  },
  note: {
    type: String,
    default: null
  },

  // ── การยืนยัน (Confirmation) ──────────────────────────────────
  // ครู/Manager ยืนยัน
  teacherConfirmed: {
    type: Boolean,
    default: false
  },
  teacherConfirmedAt: {
    type: Date,
    default: null
  },
  // นักเรียนแต่ละคนยืนยัน
  studentConfirmations: [StudentConfirmationSchema],
  // ปฏิทิน active เมื่อทุกฝ่ายยืนยันแล้ว
  isFullyConfirmed: {
    type: Boolean,
    default: false
  },

  // ── รายได้ครู/Manager ─────────────────────────────────────────
  teacherIncomeGroup: {
    type: Number,
    default: 0
  },
  teacherIncomeIndividual: {
    type: Number,
    default: 0
  },
  // รายได้จริง — อัปเดตอัตโนมัติหลังเช็คชื่อ
  actualTeacherIncome: {
    type: Number,
    default: null
  },
  // ── โหมดคิดรายได้ ─────────────────────────────────────────────
  // false (default) = แบบเดิม: รายได้ที่กรอกคือยอดต่อคลาส (flat) — ใช้กับข้อมูลเก่า
  // true            = ใหม่: รายได้ที่กรอกคือยอดต่อชั่วโมง × duration ของคลาส
  // ตั้งค่าเฉพาะตอนสร้างใหม่ — schedules เก่ายังคงใช้ flat ไม่กระทบรายได้ที่บันทึกไปแล้ว
  incomeHourly: {
    type: Boolean,
    default: false
  },

  // ── ราคาคอร์สสำหรับนักเรียน ──────────────────────────────────
  coursePrice: {
    type: Number,
    default: 0
  },
  totalDurationMinutes: {
    type: Number,
    default: 0
  },

  // ── QR Code สำหรับเช็คชื่อ ────────────────────────────────────
  qrToken: {
    type: String,
    default: null
  },
  qrGeneratedAt: {
    type: Date,
    default: null
  },
  qrExpiresAt: {
    type: Date,
    default: null
  },
  qrActive: {
    type: Boolean,
    default: false
  },

  // ── Manager Confirmation ──────────────────────────────────────
  managerConfirmedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  managerConfirmedAt: {
    type: Date,
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

ScheduleSchema.pre('save', function (next) {
  this.updatedAt = Date.now();

  // ── คำนวณ isFullyConfirmed (ทั้งครู + นักเรียนทุกคนยืนยัน) ──
  // ⚠ Reset เป็น false ทุกครั้ง แล้วประเมินใหม่ — ป้องกันค่าค้างเมื่อสถานะเปลี่ยน
  // (เช่น นักเรียนเปลี่ยนใจจาก accepted → declined)
  const allStudentsAccepted =
    this.studentConfirmations.length > 0 &&
    this.studentConfirmations.every(sc => sc.status === 'accepted');
  this.isFullyConfirmed = !!(this.teacherConfirmed && allStudentsAccepted);

  // คำนวณ totalDurationMinutes จาก startTime และ endTime
  if (this.startTime && this.endTime) {
    const [startH, startM] = this.startTime.split(':').map(Number);
    const [endH, endM] = this.endTime.split(':').map(Number);
    let duration = (endH * 60 + endM) - (startH * 60 + startM);
    if (duration <= 0) duration += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
    if (duration > 0) this.totalDurationMinutes = duration;
  }

  next();
});

module.exports = mongoose.model('Schedule', ScheduleSchema);
