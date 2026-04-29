const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  schedule: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scannedAt: {
    type: Date,
    default: Date.now
  },
  // IP/device fingerprint (optional - ป้องกันสแกนซ้ำ)
  deviceInfo: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// กัน student สแกนซ้ำใน schedule เดียวกัน
AttendanceSchema.index({ schedule: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', AttendanceSchema);
