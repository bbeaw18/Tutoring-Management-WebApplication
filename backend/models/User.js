const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    // ตรงกับ route-level regex — รับ TLD ยาว (.email, .museum, .info, .photography ฯลฯ)
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please provide a valid email']
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  },
  phone: {
    type: String,
    trim: true,
    unique: true,
    sparse: true
  },
  role: {
    type: String,
    enum: ['admin', 'manager', 'student', 'teacher'],
    default: 'student'
  },
  profileImage: {
    type: String,
    default: null
  },
  teachingHours: {
    type: Number,
    default: 0
  },
  // สำหรับนักเรียน — ชม.เรียนสะสม
  learningHours: {
    type: Number,
    default: 0
  },
  subjects: [{
    type: String
  }],
  bio: {
    type: String,
    default: null
  },
  grade: {
    type: String,
    default: null
  },
  parentContact: {
    type: String,
    default: null
  },
  // ชื่อผู้ปกครอง (นักเรียน)
  guardianName: {
    type: String,
    trim: true,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lineId: {
    type: String,
    trim: true
  },
  age: {
    type: Number
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  // ชื่อเล่น (ทั้งครูและนักเรียน)
  nickname: {
    type: String,
    trim: true
  },
  // เลขบัตรประชาชน (ทั้งครูและนักเรียน)
  nationalId: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,     // อนุญาต null ได้ (ไม่บังคับ unique ถ้าเป็น null)
    match: [/^\d{13}$/, 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก']
  },
  // Teacher specific
  university: {
    type: String
  },
  paymentChannel: {
    type: String
  },
  // ข้อมูลบัญชีธนาคาร (ครูเท่านั้น)
  bankAccountNumber: {
    type: String,
    trim: true
  },
  bankAccountName: {
    type: String,
    trim: true
  },
  // Student specific
  academicYear: {
    type: String
  },
  // ── ที่อยู่ (Address) ─────────────────────────────────────────
  addressDetail: { type: String, trim: true },   // บ้านเลขที่ / อาคาร / หมู่บ้าน
  moo:           { type: String, trim: true },   // หมู่ที่
  soi:           { type: String, trim: true },   // ซอย
  road:          { type: String, trim: true },   // ถนน
  subdistrict:   { type: String, trim: true },   // ตำบล / แขวง
  district:      { type: String, trim: true },   // อำเภอ / เขต
  province:      { type: String, trim: true },   // จังหวัด
  postalCode:    { type: String, trim: true },   // รหัสไปรษณีย์
  country:       { type: String, trim: true, default: 'ไทย' }, // ประเทศ
  addressNote:   { type: String, trim: true },   // หมายเหตุเพิ่มเติม
  // Google Authenticator TOTP
  totpSecret: {
    type: String
  },
  totpEnabled: {
    type: Boolean,
    default: false
  },
  registrationStatus: {
    type: String,
    enum: ['registered', 'unregistered'],
    default: function() {
      return this.role === 'teacher' ? 'unregistered' : 'registered';
    }
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  // เก็บเฉพาะ hash ของ reset token (ไม่เก็บ raw token) — แม้ DB หลุดก็ใช้ไม่ได้
  resetPasswordTokenHash: {
    type: String,
    select: false,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    select: false,
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

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    this.updatedAt = Date.now();
    next();
  } catch (error) {
    next(error);
  }
});

UserSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.toJSON = function () {
  // virtuals: true → includes the virtual `id` field (string form of _id)
  // Mongoose 7 does NOT include virtuals by default in toObject()
  const user = this.toObject({ virtuals: true });
  delete user.password;
  delete user.resetPasswordTokenHash;
  delete user.resetPasswordExpires;
  return user;
};

module.exports = mongoose.model('User', UserSchema);
