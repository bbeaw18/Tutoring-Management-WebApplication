const User = require('../models/User');
const Attendance = require('../models/Attendance');

/**
 * กลับรายการ teachingHours / learningHours ที่บันทึกไว้ตอน manager-confirm
 * (schedules.js PATCH /:id/manager-confirm) — เรียกเมื่อคลาสที่ "completed"
 * ถูกยกเลิก/ลบ เพื่อไม่ให้ชั่วโมงสะสมของครู/นักเรียนค้างเกินจริง
 *
 * ปลอดภัยต่อการเรียกซ้ำ: จะทำงานเฉพาะ schedule ที่ status === 'completed'
 * ผู้เรียกต้องเปลี่ยน status เป็น 'cancelled' หลังเรียก เพื่อกันการกลับซ้ำ
 *
 * @param {mongoose.Document} schedule — schedule doc (มี totalDurationMinutes, teacher, _id)
 */
async function reverseCompletedScheduleHours(schedule) {
  if (!schedule || schedule.status !== 'completed') return;

  const durationHours = (schedule.totalDurationMinutes || 0) / 60;
  if (durationHours <= 0) return;

  // ครู — ลด teachingHours
  if (schedule.teacher) {
    const teacherId = schedule.teacher._id || schedule.teacher;
    await User.findByIdAndUpdate(teacherId, { $inc: { teachingHours: -durationHours } });
  }

  // นักเรียนที่เช็คชื่อ — ลด learningHours (mirror ของ manager-confirm)
  const attendances = await Attendance.find({ schedule: schedule._id }).select('student');
  for (const att of attendances) {
    await User.findByIdAndUpdate(att.student, { $inc: { learningHours: -durationHours } });
  }
}

module.exports = { reverseCompletedScheduleHours };
