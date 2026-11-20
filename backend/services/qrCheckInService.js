const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Review = require('../models/Review');
const Schedule = require('../models/Schedule');
const { qrWindow } = require('../utils/qrWindow');

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function validateQr(scheduleId, token, studentId, session = null) {
  if (!mongoose.isObjectIdOrHexString(scheduleId) || typeof token !== 'string' || !token) {
    fail(400, 'ลิงก์ QR ไม่ถูกต้อง');
  }
  const schedule = await Schedule.findById(scheduleId).session(session)
    .populate('course', 'name subject teachingType').populate('teacher', 'firstName lastName nickname');
  if (!schedule) fail(404, 'ไม่พบคลาสเรียน');
  if (!schedule.students.some(student => String(student) === studentId)) fail(403, 'คุณไม่มีรายชื่อในคลาสนี้');
  if (!schedule.qrActive || schedule.qrToken !== token ||
      !['pending', 'confirmed', 'scheduled'].includes(schedule.status)) {
    fail(400, 'QR นี้ปิดหรือเปลี่ยนแล้ว กรุณาสแกน QR ล่าสุด');
  }
  const now = new Date();
  const { opensAt, closesAt } = qrWindow(schedule);
  if (now < opensAt) fail(400, 'เช็กชื่อได้ตั้งแต่ 30 นาทีก่อนจบคาบเรียน');
  if (now > closesAt || (schedule.qrExpiresAt && now > schedule.qrExpiresAt)) {
    fail(400, 'หมดเวลาเช็กชื่อแล้ว รับได้ถึง 30 นาทีหลังจบคาบเรียน');
  }
  return schedule;
}

async function confirmQrCheckIn({ scheduleId, token, studentId, rating, comment = '', deviceInfo }) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fail(400, 'กรุณาให้คะแนนตั้งแต่ 1 ถึง 5 ดาว');
  if (typeof comment !== 'string' || comment.length > 500) fail(400, 'ความคิดเห็นต้องไม่เกิน 500 ตัวอักษร');
  await Promise.all([Attendance.init(), Review.init()]);
  let result;
  await mongoose.connection.transaction(async session => {
    const schedule = await validateQr(scheduleId, token, studentId, session);
    // Serialize against QR closing/rotation so attendance and review commit together.
    const locked = await Schedule.updateOne({
      _id: schedule._id, qrToken: token, qrActive: true, status: schedule.status
    }, { $set: { updatedAt: new Date() }, $inc: { __v: 1 } }, { session });
    if (!locked.matchedCount) fail(400, 'QR นี้ปิดหรือเปลี่ยนแล้ว กรุณาสแกน QR ล่าสุด');
    const attendance = await Attendance.findOneAndUpdate({
      schedule: schedule._id, student: studentId
    }, { $setOnInsert: { scannedAt: new Date(), deviceInfo } },
    { upsert: true, new: true, session });
    const review = await Review.findOneAndUpdate({
      schedule: schedule._id, student: studentId
    }, { $setOnInsert: { teacher: schedule.teacher._id, rating, comment: comment.trim() } },
    { upsert: true, new: true, runValidators: true, session });
    result = { scannedAt: attendance.scannedAt, courseName: schedule.course?.name, reviewSubmitted: !!review };
  });
  return result;
}

module.exports = { validateQr, confirmQrCheckIn };
