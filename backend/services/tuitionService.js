const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Payment = require('../models/Payment');
const PaymentSession = require('../models/PaymentSession');
const TuitionQuote = require('../models/TuitionQuote');
const User = require('../models/User');
const { computeEffectivePrice } = require('../utils/helpers');

const thaiMonth = date => new Date(new Date(date).getTime() + 7 * 3600000).toISOString().slice(0, 7);
const total = items => items.reduce((sum, row) => sum + row.amount, 0);
const validMonth = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const paymentCoverageFields = 'student schedule scheduleIds paymentType paymentMonth amount method status transactionRef';

const targetFilter = ({ scheduleId, month }) => {
  if (scheduleId && !month && mongoose.isObjectIdOrHexString(scheduleId)) return { schedule: scheduleId };
  if (!scheduleId && validMonth(month)) return { month };
  throw httpError(400, 'กรุณาระบุคลาสหรือเดือนที่ต้องการชำระ');
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function resolvePaymentCoverage(payments, session = null) {
  const aggregate = payment => payment.paymentType === 'monthly' && (payment.method === 'gateway' || !payment.schedule);
  const lookingUp = payments.filter(p => aggregate(p) && p.method === 'gateway' && p.status === 'confirmed'
    && !p.scheduleIds?.length && p.transactionRef);
  const receipts = lookingUp.length ? await PaymentSession.find({
    status: 'paid', reference: { $in: lookingUp.map(p => p.transactionRef) }
  }).select('reference student amount paymentType paymentMonth scheduleIds').session(session).lean() : [];
  const byReference = new Map(receipts.map(receipt => [receipt.reference, receipt]));
  return payments.map(payment => {
    const first = payment.schedule?._id || payment.schedule;
    if (payment.scheduleIds?.length) return { payment, scheduleIds: payment.scheduleIds, review: false };
    if (!aggregate(payment)) return { payment, scheduleIds: first ? [first] : [], review: false };
    const receipt = byReference.get(payment.transactionRef);
    if (receipt?.scheduleIds.length && receipt.paymentType === 'monthly'
      && receipt.paymentMonth === payment.paymentMonth && receipt.amount === payment.amount
      && String(receipt.student) === String(payment.student)
      && (!first || receipt.scheduleIds.some(id => String(id) === String(first)))) {
      return { payment, scheduleIds: receipt.scheduleIds, review: false };
    }
    return { payment, scheduleIds: first ? [first] : [], review: true };
  });
}

async function getPaymentCoverage(student, session = null) {
  const payments = await Payment.find({ student, status: { $in: ['pending', 'confirmed'] } })
    .select(paymentCoverageFields)
    .session(session).lean();
  const resolved = await resolvePaymentCoverage(payments, session);
  return {
    blocked: new Set(resolved.flatMap(entry => entry.scheduleIds.map(String))),
    review: resolved.filter(entry => entry.review).map(({ payment }) => reviewPayment(payment))
  };
}

const reviewPayment = payment => ({
  paymentId: payment._id,
  month: validMonth(payment.paymentMonth) ? payment.paymentMonth : null,
  amount: payment.amount,
  reference: payment.transactionRef || null
});

async function listTuitionReviewHolds() {
  const payments = await Payment.find({
    paymentType: 'monthly',
    status: { $in: ['pending', 'confirmed'] },
    'scheduleIds.0': { $exists: false },
    $or: [{ method: 'gateway' }, { schedule: null }]
  }).select(paymentCoverageFields).sort({ createdAt: -1 }).lean();
  const holds = (await resolvePaymentCoverage(payments)).filter(entry => entry.review);
  const students = await User.find({ _id: { $in: holds.map(({ payment }) => payment.student) } })
    .select('firstName lastName nickname').lean();
  const byId = new Map(students.map(student => [String(student._id), student]));
  return holds.map(({ payment }) => {
    const student = byId.get(String(payment.student));
    return {
      ...reviewPayment(payment),
      studentId: payment.student,
      name: student ? (student.nickname || `${student.firstName} ${student.lastName}`) : String(payment.student)
    };
  });
}

const onHold = (coverage, month) => coverage.review.some(entry => !entry.month || !month || entry.month === month);

async function getTuitionDetails(student, target = {}, session = null) {
  const filter = { student };
  if (target.schedule) filter.schedule = target.schedule;
  if (target.schedules) filter.schedule = { $in: target.schedules };
  const [attendance, coverage] = session
    ? [await findAttendance(), await getPaymentCoverage(student, session)]
    : await Promise.all([findAttendance(), getPaymentCoverage(student)]);
  const schedules = new Map(attendance.filter(row => row.schedule).map(row => [String(row.schedule._id), row.schedule]));
  const unpaid = attendance.flatMap(({ schedule, scannedAt }) => {
    if (!schedule?.course || coverage.blocked.has(String(schedule._id))
      || !['completed', 'awaiting_confirmation'].includes(schedule.status)
      || !schedule.students.some(id => String(id) === String(student))) return [];
    const month = thaiMonth(schedule.date);
    if ((target.month && month !== target.month) || onHold(coverage, month)) return [];
    const amount = computeEffectivePrice(schedule);
    if (!Number.isFinite(amount) || amount <= 0) return [];
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
  return { unpaid, coverage, schedules };

  function findAttendance() {
    return Attendance.find(filter).session(session).populate({
      path: 'schedule',
      populate: { path: 'course', select: 'name subject' }
    }).lean();
  }

}

async function getTuition(student, target = {}, session = null) {
  return (await getTuitionDetails(student, target, session)).unpaid;
}

async function getOverdueTuition(student, round) {
  return (await getTuition(student)).filter(row => row.month < round);
}

function quoteMayBeClaimed(quote, coverage, schedules) {
  return quote.items.length > 0 && quote.items.every(item => {
    const id = String(item.schedule);
    const date = schedules.get(id)?.date;
    const month = item.month || quote.month || (date && thaiMonth(date));
    return !coverage.blocked.has(id) && !onHold(coverage, month);
  });
}

const quoteItems = rows => rows.map(row => ({
  schedule: row.scheduleId, course: row.course, amount: row.amount, month: row.month
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

    const { unpaid, coverage, schedules } = await getTuitionDetails(student,
      quote ? { schedules: quote.items.map(item => item.schedule) } : target, session);
    const items = quote ? quote.items : quoteItems(unpaid);
    if (!items.length || (quote && !quoteMayBeClaimed(quote, coverage, schedules))) {
      throw httpError(409, 'รายการชำระเปลี่ยนแล้ว กรุณาตรวจสถานะหรือติดต่อผู้จัดการหากโอนไปแล้ว');
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

module.exports = {
  getTuition, getTuitionDetails, getPaymentCoverage, resolvePaymentCoverage, quoteMayBeClaimed, onHold,
  getOverdueTuition, listTuitionReviewHolds, thaiMonth, total, targetFilter, quoteItems, quoteMatches, claimTuition
};
