const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Payment = require('../models/Payment');
const TuitionQuote = require('../models/TuitionQuote');
const User = require('../models/User');
const { computeEffectivePrice } = require('../utils/helpers');

const thaiMonth = date => new Date(new Date(date).getTime() + 7 * 3600000).toISOString().slice(0, 7);
const total = items => items.reduce((sum, row) => sum + row.amount, 0);

const targetFilter = ({ scheduleId, month }) => {
  if (scheduleId && !month && mongoose.isObjectIdOrHexString(scheduleId)) return { schedule: scheduleId };
  if (!scheduleId && typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { month };
  throw httpError(400, 'กรุณาระบุคลาสหรือเดือนที่ต้องการชำระ');
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function getTuition(student, target = {}, session = null) {
  const filter = { student };
  if (target.schedule) filter.schedule = target.schedule;
  if (target.schedules) filter.schedule = { $in: target.schedules };
  const [attendance, blocking] = session
    ? [await findAttendance(), await findBlocking()]
    : await Promise.all([findAttendance(), findBlocking()]);
  const blocked = new Set(blocking.map(row => String(row.schedule)));
  return attendance.flatMap(({ schedule, scannedAt }) => {
    if (!schedule?.course || blocked.has(String(schedule._id))
      || !['completed', 'awaiting_confirmation'].includes(schedule.status)
      || !schedule.students.some(id => String(id) === String(student))) return [];
    const month = thaiMonth(schedule.date);
    if (target.month && month !== target.month) return [];
    const amount = computeEffectivePrice(schedule);
    if (!Number.isFinite(amount) || (target.includeZero ? amount < 0 : amount <= 0)) return [];
    return [{
      scheduleId: schedule._id,
      course: schedule.course._id,
      courseName: schedule.course.name,
      subject: schedule.course.subject,
      date: schedule.date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      durationMinutes: schedule.totalDurationMinutes,
      attendedAt: scannedAt,
      month,
      amount
    }];
  });

  function findAttendance() {
    return Attendance.find(filter).session(session).populate({
      path: 'schedule',
      populate: { path: 'course', select: 'name subject' }
    }).lean();
  }

  function findBlocking() {
    return Payment.find({ ...filter, status: { $in: ['pending', 'confirmed'] } })
      .select('schedule').session(session).lean();
  }
}

const quoteItems = rows => rows.map(row => ({
  schedule: row.scheduleId, course: row.course, amount: row.amount
}));

const quoteMatches = (quote, rows) => {
  const current = new Map(rows.map(row => [String(row.scheduleId), row]));
  return quote.items.length === rows.length && quote.items.every(item => {
    const row = current.get(String(item.schedule));
    return row && String(item.course) === String(row.course) && item.amount === row.amount;
  });
};

async function claimTuition(student, body) {
  const { quoteId, transactionRef, note } = body;
  if (quoteId && !mongoose.isObjectIdOrHexString(quoteId)) throw httpError(400, 'QR ไม่ถูกต้อง');
  const target = quoteId ? null : targetFilter(body);
  let result;
  // The MongoDB driver used by Mongoose 7 returns the commit response.
  await mongoose.connection.transaction(async session => {
    // Serialize concurrent claims by this student, including overlapping class/month quotes.
    const active = await User.updateOne({ _id: student, role: 'student', isActive: true },
      { $inc: { tuitionRevision: 1 } }, { session, timestamps: false });
    if (!active.matchedCount) throw httpError(403, 'บัญชีนี้ไม่สามารถแจ้งโอนได้');

    const quote = quoteId && await TuitionQuote.findOne({ _id: quoteId, student }).session(session);
    if (quoteId && !quote) throw httpError(404, 'ไม่พบรายการโอนของบัญชีนี้');
    const month = quote ? quote.month : target.month;
    const description = month ? `ค่าเรียนรวมเดือน ${month}` : 'ค่าเรียนรายคลาส';
    if (quote?.paymentIds.length) {
      const pending = await Payment.exists({ _id: { $in: quote.paymentIds }, status: 'pending' }).session(session);
      if (!pending) throw httpError(409, 'รายการนี้ได้รับการตรวจแล้ว กรุณาดูสถานะล่าสุดในหน้าค่าเรียน');
      result = { paymentIds: quote.paymentIds, totalAmount: total(quote.items), description, created: false };
      return;
    }

    const rows = await getTuition(student, quote
      ? { schedules: quote.items.map(item => item.schedule), includeZero: true }
      : target, session);
    const items = quote ? quote.items : quoteItems(rows);
    if (!items.length || rows.length !== items.length) {
      throw httpError(409, 'รายการชำระเปลี่ยนแล้ว กรุณาตรวจสถานะหรือติดต่อผู้จัดการหากโอนไปแล้ว');
    }
    const current = new Map(rows.map(row => [String(row.scheduleId), row]));
    if (items.some(item => String(current.get(String(item.schedule)).course) !== String(item.course))) {
      throw httpError(409, 'ข้อมูลคลาสเปลี่ยนแล้ว กรุณาติดต่อผู้จัดการหากโอนไปแล้ว');
    }
    const payments = await Payment.insertMany(items.map(item => ({
      student,
      schedule: item.schedule,
      course: item.course,
      paymentType: month ? 'monthly' : 'per_class',
      paymentMonth: month || null,
      amount: item.amount,
      tuitionQuote: quote?._id,
      method: 'transfer',
      transactionRef: transactionRef || null,
      note: note || null,
      status: 'pending'
    })), { session });
    const paymentIds = payments.map(payment => payment._id);
    if (quote) {
      quote.paymentIds = paymentIds;
      await quote.save({ session });
    }
    result = { paymentIds, totalAmount: total(items), description, created: true };
  });
  return result;
}

module.exports = { getTuition, thaiMonth, total, targetFilter, quoteItems, quoteMatches, claimTuition };
