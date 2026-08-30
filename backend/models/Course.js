const mongoose = require('mongoose');

const CourseSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // นักเรียนที่ถูกจองในคอร์สนี้
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  maxStudents: {
    type: Number,
    default: 30
  },
  // ประเภทการสอน: กลุ่ม หรือ เดี่ยว
  type: {
    type: String,
    enum: ['group', 'individual'],
    default: 'group'
  },
  // difficulty เก็บไว้เพื่อ backward compat — ไม่ enforce enum อีกต่อไป
  difficulty: {
    type: String,
    default: ''
  },
  // ระดับชั้นนักเรียน เช่น ม.1, ม.2, ป.6
  gradeLevel: {
    type: String,
    trim: true,
    default: ''
  },
  // วันที่นัดสอน
  scheduledDate: {
    type: Date,
    default: null
  },
  // ตารางสอนรายสัปดาห์ (ใช้กับคอร์สแบบ recurring — optional)
  schedule: {
    dayOfWeek: {
      type: String,
      default: undefined
    },
    startTime: {
      type: String,
      default: undefined
    },
    endTime: {
      type: String,
      default: undefined
    }
  },
  // เวลาสอน (สำหรับการจองแบบ one-time)
  startTime: {
    type: String,
    default: null
  },
  endTime: {
    type: String,
    default: null
  },
  price: {
    type: Number,
    default: 0
  },
  // ── รายได้ครู / ราคาสำหรับนักเรียน ─────────────────────────────
  teacherIncomeIndividual: { type: Number, default: 0 },
  teacherIncomeGroup:      { type: Number, default: 0 },
  coursePrice:             { type: Number, default: 0 },
  // โหมดคิดรายได้: false = flat (เดิม), true = ต่อชั่วโมง × duration
  incomeHourly:            { type: Boolean, default: false },
  // ── ประเภทการสอน (free-text, บันทึกลง DB แล้วดึงเป็น dropdown) ──
  teachingType: { type: String, default: '' },
  // ── ชุดนัดสอนอัตโนมัติ (สร้างซ้ำรายสัปดาห์จนถึงสิ้นเดือน) ──
  // คอร์สทั้งหมดที่ถูกสร้างจากการกดสร้างชุดเดียวกันจะแชร์ seriesId เดียวกัน
  // seriesSize = จำนวนคลาสทั้งหมดในชุด (ใช้แสดงบน UI โดยไม่ต้อง query ทั้งชุด)
  seriesId:   { type: String, default: null, index: true },
  seriesSize: { type: Number, default: 1 },
  // ── คอร์ส (แพ็กเกจ) ── นักเรียนต้องชำระเงินทั้งคอร์สก่อนจึงเช็คชื่อเข้าเรียนได้
  //   ทุกคลาสในชุด (seriesId เดียวกัน) จะถูก stamp ค่านี้เหมือนกัน
  isCoursePackage: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['pending', 'approved', 'active', 'completed', 'cancelled'],
    default: 'pending'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  teacherAccepted: {
    type: Boolean,
    default: false
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

// ── Indexes — GET /courses filter ตาม role (teacher/students) + sort createdAt ──
CourseSchema.index({ teacher: 1 });      // teacher role query
CourseSchema.index({ students: 1 });     // student role query
CourseSchema.index({ createdAt: -1 });   // default sort

CourseSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Course', CourseSchema);
