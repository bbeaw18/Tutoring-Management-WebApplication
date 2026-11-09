const express = require('express');
const { setTimeout: wait } = require('node:timers/promises');
const { isObjectIdOrHexString } = require('mongoose');
const Attendance = require('../models/Attendance');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const Schedule = require('../models/Schedule');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { bangkokMonthRange, sendResponse } = require('../utils/helpers');
const { buildPaymentSummariesByScheduleId, deriveDisplayStatus } = require('../utils/scheduleAggregation');

const router = express.Router();
const personFields = 'firstName lastName nickname';
const classFields = 'course teacher date startTime endTime room status qrClosedAt';
const reviewableClass = {
  status: { $in: ['awaiting_confirmation', 'completed'] },
  qrActive: { $ne: true }
};
// Admin force-close creates attendance for billing even when nobody checked in.
const actualCheckIn = { deviceInfo: { $not: /^admin-force-close:/ } };

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, authenticateToken, async (req, res, next) => {
  try {
    if (!isObjectIdOrHexString(req.user?.id)) return sendResponse(res, 401, false, null, 'กรุณาเข้าสู่ระบบใหม่');
    const user = await User.findById(req.user.id).select('role isActive');
    if (!user?.isActive || user.role !== req.user.role) {
      return sendResponse(res, 401, false, null, 'บัญชีหรือสิทธิ์มีการเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
    }
    next();
  } catch (error) {
    next(error);
  }
});

router.param('scheduleId', (req, res, next, id) => {
  if (!isObjectIdOrHexString(id)) return sendResponse(res, 400, false, null, 'รหัสคลาสไม่ถูกต้อง');
  next();
});

function withClassNames(query) {
  return query.populate('course', 'name subject teachingType seriesSize').populate('teacher', personFields).lean();
}

function sendStudentReview(res, data = null) {
  return res.json({ success: true, data, message: '' });
}

async function getReviewableAttendance(student, schedule) {
  const attendance = await Attendance.findOne({ student, schedule, ...actualCheckIn })
    .select('scannedAt reviewPromptDismissedAt').lean();
  if (!attendance) return null;

  const lesson = await withClassNames(Schedule.findOne({
    _id: schedule, students: student, ...reviewableClass
  }).select(classFields));
  return lesson?.teacher ? { lesson, attendance } : null;
}

async function findPendingReview(student, scheduleId) {
  const scope = scheduleId ? { schedule: scheduleId } : {};
  const [attendances, reviewed] = await Promise.all([
    Attendance.find({ student, ...scope, reviewPromptDismissedAt: null, ...actualCheckIn })
      .select('schedule scannedAt').lean(),
    Review.distinct('schedule', { student, ...scope })
  ]);
  const alreadyReviewed = new Set(reviewed.map(String));
  const checkIns = new Map(attendances.filter(a => !alreadyReviewed.has(String(a.schedule)))
    .map(a => [String(a.schedule), a]));
  if (!checkIns.size) return { entry: null, waiting: false };

  const schedules = { _id: { $in: [...checkIns.keys()] }, students: student };
  const lessons = await withClassNames(Schedule.find({
    ...schedules, ...reviewableClass,
    qrClosedAt: { $type: 'date' }
  }).select(classFields).sort({ qrClosedAt: -1 }));
  const lesson = lessons.find(item => item.teacher);
  if (lesson) {
    return { entry: { lesson, scannedAt: checkIns.get(String(lesson._id)).scannedAt }, waiting: false };
  }
  const waiting = await Schedule.exists({ ...schedules, status: { $in: ['pending', 'confirmed', 'scheduled'] } });
  return { entry: null, waiting: !!waiting };
}

router.get('/pending', roleCheck(['student']), async (req, res, next) => {
  const { scheduleId } = req.query;
  if (scheduleId !== undefined && (typeof scheduleId !== 'string' || !isObjectIdOrHexString(scheduleId))) {
    return sendResponse(res, 400, false, null, 'รหัสคลาสไม่ถูกต้อง');
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once('close', cancel);
  const deadline = Date.now() + (req.query.wait === '1' ? 20_000 : 0);
  try {
    while (!controller.signal.aborted) {
      const { entry, waiting } = await findPendingReview(req.user.id, scheduleId);
      if (controller.signal.aborted) return;
      const remaining = deadline - Date.now();
      if (entry || remaining <= 0) return sendStudentReview(res, entry);
      await wait(waiting ? Math.min(2000, remaining) : remaining, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted) next(error);
  } finally {
    res.off('close', cancel);
  }
});

router.get('/mine/:scheduleId', roleCheck(['student']), async (req, res, next) => {
  try {
    const { scheduleId } = req.params;
    const student = req.user.id;
    const entry = await getReviewableAttendance(student, scheduleId);
    if (!entry) return sendStudentReview(res);
    const submitted = await Review.exists({ schedule: scheduleId, student });
    sendStudentReview(res, { lesson: entry.lesson, scannedAt: entry.attendance.scannedAt, submitted: !!submitted });
  } catch (error) {
    next(error);
  }
});

router.post('/:scheduleId/dismiss', roleCheck(['student']), async (req, res, next) => {
  try {
    const entry = await getReviewableAttendance(req.user.id, req.params.scheduleId);
    if (entry && !entry.attendance.reviewPromptDismissedAt) {
      await Attendance.updateOne({ _id: entry.attendance._id, reviewPromptDismissedAt: null },
        { $set: { reviewPromptDismissedAt: new Date() } });
    }
    sendResponse(res, 200, true);
  } catch (error) {
    next(error);
  }
});

router.post('/:scheduleId', roleCheck(['student']), async (req, res, next) => {
  try {
    const { rating, comment = '' } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return sendResponse(res, 400, false, null, 'กรุณาให้คะแนนตั้งแต่ 1 ถึง 5 ดาว');
    }
    if (typeof comment !== 'string' || comment.length > 500) {
      return sendResponse(res, 400, false, null, 'ความคิดเห็นต้องมีความยาวไม่เกิน 500 ตัวอักษร');
    }
    const student = req.user.id;
    const schedule = req.params.scheduleId;
    const entry = await getReviewableAttendance(student, schedule);
    if (!entry) return sendResponse(res, 403, false, null, 'ส่งรีวิวได้เฉพาะคลาสที่เช็กชื่อแล้วและปิด QR แล้ว');
    await Review.init();
    await Review.create({ schedule, student, teacher: entry.lesson.teacher._id, rating, comment });
    sendResponse(res, 201, true, null, 'ส่งรีวิวเรียบร้อยแล้ว');
  } catch (error) {
    if (error.code === 11000) return sendResponse(res, 409, false, null, 'ส่งรีวิวสำหรับคลาสนี้แล้ว');
    next(error);
  }
});

router.get('/', roleCheck(['admin']), async (req, res, next) => {
  try {
    const { month } = req.query;
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return sendResponse(res, 400, false, null, 'กรุณาระบุเดือนของคลาส');
    }
    const { start, end } = bangkokMonthRange(month);
    const offset = 7 * 60 * 60 * 1000;
    const bangkokNow = new Date(Date.now() + offset);
    bangkokNow.setUTCHours(0, 0, 0, 0);
    bangkokNow.setUTCDate(bangkokNow.getUTCDate() - (bangkokNow.getUTCDay() + 6) % 7);
    const weekStart = new Date(bangkokNow.getTime() - offset);
    const lessons = await withClassNames(Schedule.find({ date: { $gte: start, $lt: end } })
      .select(`${classFields} students studentConfirmations teacherConfirmed teacherConfirmedAt isFullyConfirmed qrGeneratedAt managerConfirmedAt createdAt coursePrice incomeHourly totalDurationMinutes actualTeacherIncome`)
      .sort({ date: -1, startTime: -1 }));
    const reviews = await Review.find({ schedule: { $in: lessons.map(lesson => lesson._id) } })
      .select('schedule student rating comment createdAt')
      .populate('student', personFields).sort({ createdAt: -1 }).lean();
    const byLesson = new Map();
    for (const review of reviews) {
      const id = String(review.schedule);
      if (!byLesson.has(id)) byLesson.set(id, []);
      byLesson.get(id).push(review);
    }

    const reviewedLessons = lessons.filter(lesson => byLesson.has(String(lesson._id)));
    const [summaries, newThisWeek] = await Promise.all([
      buildPaymentSummariesByScheduleId(reviewedLessons),
      Review.countDocuments({ createdAt: { $gte: weekStart } })
    ]);
    const classes = reviewedLessons.map(({ students, studentConfirmations, ...lesson }) => ({
      ...lesson,
      displayStatus: deriveDisplayStatus({ ...lesson, students }),
      studentCount: students?.length ?? 0,
      confirmedCount: studentConfirmations?.filter(item => item.status === 'accepted').length ?? 0,
      paymentSummary: summaries.get(String(lesson._id)),
      reviews: byLesson.get(String(lesson._id))
    }));
    sendResponse(res, 200, true, { classes, newThisWeek });
  } catch (error) {
    next(error);
  }
});

router.get('/:scheduleId/details', roleCheck(['admin']), async (req, res, next) => {
  try {
    const schedule = req.params.scheduleId;
    const review = await Review.findOne({ schedule }).select('teacher').lean();
    if (!review) return sendResponse(res, 404, false, null, 'ไม่พบรีวิวของคลาสนี้');

    const [attendances, payments, [teacherScore]] = await Promise.all([
      Attendance.find({ schedule }).select('student scannedAt')
        .populate('student', personFields).sort('scannedAt').lean(),
      Payment.find({ schedule, status: { $in: ['pending', 'confirmed'] } }).select('student status').lean(),
      Review.aggregate([
        { $match: { teacher: review.teacher } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
        { $project: { _id: 0 } }
      ])
    ]);
    const paymentByStudent = new Map();
    for (const payment of payments) {
      const id = String(payment.student);
      if (paymentByStudent.get(id) !== 'confirmed') paymentByStudent.set(id, payment.status);
    }
    const checkIns = attendances.map(attendance => ({
      student: attendance.student,
      scannedAt: attendance.scannedAt,
      paymentStatus: paymentByStudent.get(String(attendance.student?._id)) || 'unpaid'
    }));
    sendResponse(res, 200, true, { checkIns, teacherScore });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
