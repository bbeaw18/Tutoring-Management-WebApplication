/**
 * Shared aggregation helpers for Schedule responses.
 * Used by /schedules/calendar, /schedules/calendar/weekly, and
 * /attendance/teacher-history so they all return consistent paymentSummary data.
 */
const Attendance = require('../models/Attendance');
const Payment = require('../models/Payment');
const { computeEffectivePrice } = require('./helpers');

/**
 * Build per-schedule paymentSummary { paid, unpaid, pending, total, paidCount, unpaidCount }
 * Batched to avoid N+1: 2 queries (Attendance + Payment) for all schedules.
 *
 * @param {Array<mongoose.Document>} scheduleObjs — schedules with _id, coursePrice,
 *        incomeHourly, totalDurationMinutes available
 * @returns {Promise<Map<string, object>>} keyed by schedule._id.toString()
 */
async function buildPaymentSummariesByScheduleId(scheduleObjs) {
  const ids = scheduleObjs.map(s => s._id);
  if (ids.length === 0) return new Map();

  const [allAttendances, allPayments] = await Promise.all([
    Attendance.find({ schedule: { $in: ids } }).select('schedule student'),
    Payment.find({ schedule: { $in: ids }, status: { $in: ['pending', 'confirmed'] } })
      .select('schedule student amount status')
  ]);

  // Group attendance by schedule for O(1) lookup
  const attBySchedule = new Map(); // sid -> [att, ...]
  for (const att of allAttendances) {
    const sid = att.schedule.toString();
    if (!attBySchedule.has(sid)) attBySchedule.set(sid, []);
    attBySchedule.get(sid).push(att);
  }

  // Group payments — keep the strongest status per (schedule, student)
  const paymentByKey = new Map();
  for (const p of allPayments) {
    const key = `${p.schedule.toString()}:${p.student.toString()}`;
    const existing = paymentByKey.get(key);
    if (!existing || (existing.status === 'pending' && p.status === 'confirmed')) {
      paymentByKey.set(key, { status: p.status, amount: p.amount });
    }
  }

  const summaries = new Map();
  for (const s of scheduleObjs) {
    const sid = s._id.toString();
    const effPrice = computeEffectivePrice(s);
    const attendances = attBySchedule.get(sid) || [];
    const attCount = attendances.length;

    let paid = 0, pending = 0, unpaid = 0;
    let paidCount = 0, pendingCount = 0, unpaidCount = 0;

    for (const att of attendances) {
      const key = `${sid}:${att.student.toString()}`;
      const pay = paymentByKey.get(key);
      // ใช้ราคาปัจจุบันของคลาส (effPrice) เสมอ — ไม่ใช่ pay.amount เก่า
      // เพื่อให้ตรงกับหน้า calendar/history ที่อ่าน schedule.coursePrice ปัจจุบัน
      // (Payment.amount เก็บเดิมเป็น audit trail)
      if (pay?.status === 'confirmed') {
        paid += effPrice;
        paidCount++;
      } else if (pay?.status === 'pending') {
        pending += effPrice;
        pendingCount++;
      } else {
        unpaid += effPrice;
        unpaidCount++;
      }
    }

    // ── นักเรียนขาดเรียน (no-show) — คิดค่าปรับเป็นยอดค้างของนักเรียนคนนั้น ──
    // นักเรียนที่ขาดไม่มี Attendance record จึงไม่ถูกนับข้างบน ต้องบวกค่าปรับเพิ่มเอง
    let penalty = 0;
    if (s.status === 'absent' && s.absencePenalty && s.absencePenalty.penaltyAmount > 0) {
      penalty = s.absencePenalty.penaltyAmount;
      unpaid += penalty;
      unpaidCount++;
    }

    summaries.set(sid, {
      attendanceCount: attCount,
      total: attCount * effPrice + penalty,
      paid,
      pending,
      unpaid,
      paidCount,
      pendingCount,
      unpaidCount,
      effectivePrice: effPrice,
      penaltyAmount: penalty
    });
  }
  return summaries;
}

/** Standard populate field specs for Schedule responses */
const SCHEDULE_COURSE_FIELDS = 'name subject type gradeLevel teachingType description coursePrice teacherIncomeGroup teacherIncomeIndividual incomeHourly';
const SCHEDULE_TEACHER_FIELDS = 'firstName lastName nickname email role';
const SCHEDULE_STUDENT_FIELDS = 'firstName lastName nickname email grade academicYear';

/**
 * Unified display status — มาจาก Schedule.status + teacherConfirmed + isFullyConfirmed
 * ใช้ทุกหน้า (calendar, history, revenue, course-management) ให้แสดงผลตรงกัน
 *
 * Returns one of:
 *   - 'cancelled'         → ยกเลิก
 *   - 'completed'         → เสร็จสิ้น
 *   - 'awaiting_manager'  → รอ Manager ยืนยันเสร็จสิ้น
 *   - 'confirmed'         → ยืนยันแล้ว (ทั้งครู + นักเรียนทุกคนยืนยัน)
 *   - 'pending_students'  → รอนักเรียนยืนยัน (ครูยืนยันแล้ว แต่นักเรียนบางคนยังไม่ยืนยัน)
 *   - 'pending_teacher'   → รอครูยืนยัน
 */
function deriveDisplayStatus(schedule) {
  if (!schedule) return 'pending_teacher';
  const s = schedule.status;

  if (s === 'cancelled')              return 'cancelled';
  if (s === 'absent')                 return 'absent';
  if (s === 'completed')              return 'completed';
  if (s === 'awaiting_confirmation')  return 'awaiting_manager';

  // status ∈ { 'pending', 'confirmed', 'scheduled' } → ดูจากการยืนยัน
  if (!schedule.teacherConfirmed)     return 'pending_teacher';

  // ครูยืนยันแล้ว — เช็คว่านักเรียนทุกคนยืนยันด้วยไหม
  // (เคสไม่มีนักเรียน → ถือว่ายืนยันครบ)
  const hasStudents = Array.isArray(schedule.students) && schedule.students.length > 0;
  if (hasStudents && !schedule.isFullyConfirmed) return 'pending_students';
  return 'confirmed';
}

module.exports = {
  buildPaymentSummariesByScheduleId,
  deriveDisplayStatus,
  SCHEDULE_COURSE_FIELDS,
  SCHEDULE_TEACHER_FIELDS,
  SCHEDULE_STUDENT_FIELDS
};
