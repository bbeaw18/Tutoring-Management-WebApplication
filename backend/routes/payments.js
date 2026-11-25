const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const PaymentSession = require('../models/PaymentSession');
const TuitionQuote = require('../models/TuitionQuote');
const KBankReconciliation = require('../models/KBankReconciliation');
const { getTuition, getTuitionDetails, getPaymentCoverage, resolvePaymentCoverage, quoteMayBeClaimed, onHold,
  listTuitionReviewHolds, thaiMonth, total, targetFilter, quoteItems, quoteMatches, claimTuition } = require('../services/tuitionService');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Course = require('../models/Course');
const Notification = require('../models/Notification');
const TeacherPayout = require('../models/TeacherPayout');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject, computeEffectivePrice, computeEffectiveTeacherIncome } = require('../utils/helpers');
const { deriveDisplayStatus } = require('../utils/scheduleAggregation');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

// ── KBank helpers ─────────────────────────────────────────────────────────────
const KBANK_API_URL   = process.env.KBANK_API_URL   || 'https://openapi.kasikornbank.com'; // production
const KBANK_PARTNER_ID = process.env.KBANK_PARTNER_ID || '';
const KBANK_PARTNER_SECRET = process.env.KBANK_PARTNER_SECRET || '';
const KBANK_WEBHOOK_SECRET = process.env.KBANK_WEBHOOK_SECRET || '';

/** สร้าง reference ID ที่ unique ต่อ session */
function generateReference() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `KMS-${ts}-${rnd}`;
}

/** ตรวจสอบ signature จาก KBank webhook */
function verifyKBankSignature(rawBody, signature) {
  if (!KBANK_WEBHOOK_SECRET || !Buffer.isBuffer(rawBody) || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto
    .createHmac('sha256', KBANK_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

/**
 * สร้าง KBank QR Payment Charge
 * ─────────────────────────────
 * TODO: เมื่อได้รับ KBANK_PARTNER_ID + KBANK_PARTNER_SECRET จาก KBank Developer Portal
 *       แล้วให้แทน implementation นี้ด้วย KBank OAuth + QR Payment API จริง
 *
 * KBank API Reference:
 *   1. POST {KBANK_API_URL}/oauth/token  → ได้ access_token
 *   2. POST {KBANK_API_URL}/payment/qr/create → ได้ qrRawData + txnId
 */
async function createKBankCharge({ reference, amount, description }) {
  if (!KBANK_PARTNER_ID || !KBANK_PARTNER_SECRET) {
    // ── Fallback: ใช้ PromptPay QR ธรรมดา (รอ KBank credentials) ────────────
    const promptpayId = process.env.PROMPTPAY_ID;
    if (!promptpayId) throw new Error('ยังไม่ได้ตั้งค่า PROMPTPAY_ID หรือ KBANK credentials');
    const payload = generatePayload(promptpayId, { amount });
    const qrDataURL = await QRCode.toDataURL(payload);
    return { qrDataURL, kbankTxnId: null, mode: 'promptpay_fallback' };
  }

  // ── KBank API (เปิดใช้งานเมื่อมี credentials) ────────────────────────────
  // Step 1: Get OAuth token
  const tokenRes = await axios.post(`${KBANK_API_URL}/oauth/token`, {
    grant_type: 'client_credentials',
    client_id: KBANK_PARTNER_ID,
    client_secret: KBANK_PARTNER_SECRET
  });
  const accessToken = tokenRes.data.access_token;

  // Step 2: Create QR Payment
  const chargeRes = await axios.post(
    `${KBANK_API_URL}/payment/qr/create`,
    {
      partnerTxnRef: reference,
      partnerTxnDt: new Date().toISOString(),
      amount: amount.toFixed(2),
      currencyCode: 'THB',
      description,
      qrType: 'PP'  // PromptPay
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );

  const qrDataURL = await QRCode.toDataURL(chargeRes.data.qrRawData);
  return { qrDataURL, kbankTxnId: chargeRes.data.txnId, mode: 'kbank' };
}

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// M2: MIME + extension validation (ป้องกัน double-extension / mimetype spoofing)
const ALLOWED_MIMES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png':  ['.png'],
  'image/gif':  ['.gif'],
  'application/pdf': ['.pdf']
};

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    // Sanitize extension — ใช้เฉพาะ extension ที่ whitelist เท่านั้น
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const safeExt = ALLOWED_MIMES[file.mimetype]?.includes(ext) ? ext : '';
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const allowedExts = ALLOWED_MIMES[file.mimetype];
    if (!allowedExts) {
      return cb(new Error('Invalid file type (mimetype not allowed)'));
    }
    if (!allowedExts.includes(ext)) {
      return cb(new Error('File extension does not match MIME type'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || 10485760),  // M2: 10MB (จากเดิม 50MB) — slip ไม่ควรใหญ่กว่านี้
    files: 1
  }
});

router.post('/', authenticateToken, upload.single('slipImage'), async (req, res) => {
  try {
    const { course, amount, method, transactionRef, schedule, paymentType, paymentMonth } = req.body;

    if (!course || !amount || !method) {
      return sendResponse(res, 400, false, null, 'Missing required fields');
    }

    const courseExists = await Course.findById(course);
    if (!courseExists) {
      return sendResponse(res, 400, false, null, 'Course not found');
    }

    const student = req.user.id;
    const slipImage = req.file ? `/uploads/${req.file.filename}` : null;

    const payment = new Payment({
      student,
      course,
      schedule: schedule || null,
      paymentType: paymentType || 'per_class',
      paymentMonth: paymentMonth || null,
      amount: parseFloat(amount),
      method,
      slipImage,
      transactionRef: transactionRef || null,
      status: 'pending'
    });

    await payment.save();
    await payment.populate('student', 'firstName lastName nickname email');
    await payment.populate('course', 'name price');

    const managers = await User.find({ role: 'manager' });
    for (const manager of managers) {
      const notification = new Notification({
        recipient: manager._id,
        sender: student,
        type: 'payment',
        title: 'New Payment Submission',
        message: `New payment of ${amount} for ${courseExists.name}`,
        relatedId: payment._id
      });
      await notification.save();
    }

    sendResponse(res, 201, true, payment, 'Payment submitted');
  } catch (error) {
    console.error('Create payment error:', error);
    if (req.file) {
      fs.unlink(path.join(uploadDir, req.file.filename), (err) => {
        if (err) console.error('File delete error:', err);
      });
    }
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { student, course, status, schedule } = req.query;

    let query = {};

    if (req.user.role === 'student') {
      query.student = req.user.id;
    }

    if (student && ['admin', 'manager'].includes(req.user.role)) {
      query.student = student;
    }
    if (course)   query.course   = course;
    if (status)   query.status   = status;
    if (schedule) query.schedule = schedule;

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
      .populate('student', 'firstName lastName nickname email')
      .populate('course', 'name price')
      .populate('confirmedBy', 'firstName lastName nickname')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, payments, 'Payments retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get payments error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /unpaid — ดูรายการยังไม่ได้ชำระของนักเรียน (per-schedule)
// IMPORTANT: must be BEFORE /:id route to avoid Express routing conflict
// ────────────────────────────────────────────────────────────────────────────
router.get('/unpaid', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const student = req.user.id;
    const { unpaid, coverage, schedules } = await getTuitionDetails(student);
    const payable = new Set(unpaid.map(row => String(row.scheduleId)));
    const quotes = await TuitionQuote.find({ student, 'paymentIds.0': { $exists: false } })
      .sort({ createdAt: -1, _id: -1 }).lean();
    const latest = new Set();
    const recoverableQuotes = [];
    for (const quote of quotes) {
      const target = quote.month || String(quote.schedule);
      if (latest.has(target)) continue;
      latest.add(target);
      if (!quote.items.some(item => !payable.has(String(item.schedule))) ||
        !quoteMayBeClaimed(quote, coverage, schedules)) continue;
      recoverableQuotes.push({ quoteId: quote._id, month: quote.month, scheduleId: quote.schedule,
        classDate: schedules.get(String(quote.schedule))?.date,
        amount: total(quote.items), createdAt: quote.createdAt });
    }
    const reviewMonths = [...new Set(coverage.review.map(entry => entry.month))];
    sendResponse(res, 200, true, { unpaid, totalAmount: total(unpaid), recoverableQuotes, reviewMonths },
      'Unpaid items retrieved');
  } catch (error) {
    console.error('Get unpaid error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /revenue/summary — สรุปรายได้ (admin/manager)
// IMPORTANT: must be BEFORE /:id route to avoid Express routing conflict
// ────────────────────────────────────────────────────────────────────────────
router.get('/revenue/summary', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = { status: 'confirmed' };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const payments = await Payment.find(query)
      .populate('course', 'name subject');

    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const courseRevenue = {};

    payments.forEach(p => {
      const courseName = p.course.name;
      if (!courseRevenue[courseName]) {
        courseRevenue[courseName] = 0;
      }
      courseRevenue[courseName] += p.amount;
    });

    sendResponse(res, 200, true, {
      totalRevenue,
      transactionCount: payments.length,
      courseRevenue
    }, 'Revenue summary retrieved');
  } catch (error) {
    console.error('Get revenue error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /revenue-report — สรุปรายได้ตาม schedule สำหรับ manager/admin
// Query: month (YYYY-MM), teacherId, studentId
// IMPORTANT: must be BEFORE /:id route to avoid Express routing conflict
// ────────────────────────────────────────────────────────────────────────────
router.get('/revenue-report', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { month, teacherId, studentId } = req.query;

    // กรอง schedule ที่เสร็จสิ้น (awaiting_confirmation, completed) + นักเรียนขาด (absent)
    let scheduleQuery = {
      status: { $in: ['awaiting_confirmation', 'completed', 'absent'] }
    };

    if (month) {
      const [y, m] = month.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1);
      const endDate   = new Date(y, m, 0, 23, 59, 59);
      scheduleQuery.date = { $gte: startDate, $lte: endDate };
    }

    if (teacherId) {
      scheduleQuery.teacher = teacherId;
    }

    const schedules = await Schedule.find(scheduleQuery)
      .populate('course', 'name subject type gradeLevel teachingType description coursePrice teacherIncomeGroup teacherIncomeIndividual incomeHourly')
      .populate('teacher', 'firstName lastName nickname email role')
      .populate('managerConfirmedBy', 'firstName lastName nickname')
      .populate('absencePenalty.student', 'firstName lastName nickname')
      .sort({ date: -1 });

    // H5: เปลี่ยนจาก N+1 queries (Attendance.find + Payment.findOne per schedule)
    // → 2 batch queries ด้วย $in แล้ว group ด้วย Map
    const scheduleIds = schedules.map(s => s._id);

    // Batch 1: ดึง attendance ทั้งหมดของทุก schedule ในครั้งเดียว
    let attendanceQuery = { schedule: { $in: scheduleIds } };
    if (studentId) attendanceQuery.student = studentId;

    const allAttendances = await Attendance.find(attendanceQuery)
      .populate('student', 'firstName lastName nickname');

    // Group attendance by scheduleId
    const attendancesByScheduleId = new Map();
    for (const att of allAttendances) {
      const sid = att.schedule.toString();
      if (!attendancesByScheduleId.has(sid)) attendancesByScheduleId.set(sid, []);
      attendancesByScheduleId.get(sid).push(att);
    }

    const attendingStudents = [...new Set(allAttendances.flatMap(att => att.student ? [String(att.student._id)] : []))];
    // Batch 2: ดึง payments ของทุก schedule รวมใบรับเงิน KBank ที่อ้างคลาสแรกอีกคลาสหนึ่ง
    const allPayments = await Payment.find({
      $or: [
        { schedule: { $in: scheduleIds } },
        { scheduleIds: { $in: scheduleIds } },
        { method: 'gateway', paymentType: 'monthly', student: { $in: attendingStudents } }
      ],
      status: { $in: ['pending', 'confirmed'] }
    }).select('_id student schedule scheduleIds amount status tuitionQuote method paymentType paymentMonth transactionRef');

    // สร้าง map: key = "studentId:scheduleId" → sum ของ amount (เฉพาะ confirmed)
    const paidAmountByKey = new Map();
    // สร้าง map: key = "studentId:scheduleId" → payment object (สำหรับสถานะล่าสุด)
    const paymentByKey = new Map();
    for (const { payment: p, scheduleIds: coveredIds } of await resolvePaymentCoverage(allPayments)) {
      for (const coveredId of coveredIds) {
        const key = `${p.student}:${coveredId}`;
        if (p.status === 'confirmed') paidAmountByKey.set(key, (paidAmountByKey.get(key) || 0) + p.amount);
        const existing = paymentByKey.get(key);
        if (!existing || (existing.status === 'pending' && p.status === 'confirmed')) {
          paymentByKey.set(key, p);
        }
      }
    }

    const scheduleList = [];
    let kpiTotal = 0, kpiPaid = 0;
    // KPI ใหม่:
    //   - teacherExpense = รายจ่ายสถาบันสำหรับครู (role='teacher' เท่านั้น)
    //   - managerIncome  = รายได้ Manager (role='manager' ที่สอน)
    // นับเฉพาะคลาสที่ Manager ยืนยันแล้ว (status='completed')
    let kpiTeacherExpense = 0, kpiManagerIncome = 0;

    for (const s of schedules) {
      const sid = s._id.toString();
      const attendances = attendancesByScheduleId.get(sid) || [];

      // ── นักเรียนขาดเรียน (no-show) — คิดค่าปรับแทนการเข้าเรียน ──
      const isAbsent = s.status === 'absent' && s.absencePenalty && (s.absencePenalty.penaltyAmount || 0) > 0;
      const absentStudent = isAbsent ? s.absencePenalty.student : null;   // populated
      const absentStudentId = absentStudent ? String(absentStudent._id || absentStudent) : null;
      const penaltyAmount = isAbsent ? (s.absencePenalty.penaltyAmount || 0) : 0;

      // ถ้า filter studentId แล้วนักเรียนคนนั้นไม่ได้เข้าเรียน (และไม่ใช่คนที่ขาด) → ข้ามคลาสนี้
      if (studentId && attendances.length === 0 && !(isAbsent && absentStudentId === String(studentId))) continue;

      const effectivePrice = computeEffectivePrice(s);
      const totalForSchedule = attendances.length * effectivePrice + penaltyAmount;
      let paidForSchedule = 0;

      // ── ใช้ราคาปัจจุบัน (effectivePrice) สำหรับ KPI/display ──
      // เหตุผล: เมื่อ Manager แก้ไขราคาคลาสภายหลัง (เช่น 599 → 600) Payment record
      // ที่สร้างไว้ก่อนหน้ายังเก็บราคาเดิม → เกิด mismatch ระหว่าง total (ราคาใหม่)
      // กับ paid (ราคาเดิม) ทำให้ KPI เพี้ยน
      // วิธีแก้: ถ้านักเรียนชำระแล้ว → นับเป็นจ่ายตามราคาปัจจุบันของคลาส
      // (Payment.amount เก็บไว้เดิมเพื่อ audit trail)
      for (const att of attendances) {
        const key = `${att.student._id.toString()}:${sid}`;
        if ((paidAmountByKey.get(key) || 0) > 0) {
          paidForSchedule += effectivePrice;
        }
      }
      // absent → นับค่าปรับที่ชำระแล้วเป็น paid ด้วย (ไม่มี attendance ให้วน)
      if (isAbsent && absentStudentId) {
        const key = `${absentStudentId}:${sid}`;
        if ((paidAmountByKey.get(key) || 0) > 0) {
          paidForSchedule += penaltyAmount;
        }
      }

      kpiTotal += totalForSchedule;
      kpiPaid  += paidForSchedule;

      // ── คำนวณ teacher income แบบ date-gated (ไม่พึ่ง flag เก่า) ──
      // ใช้ค่านี้แทน s.actualTeacherIncome ใน KPI + scheduleList
      // (ป้องกันค่าเก่าที่ถูกบันทึกตอน flag incomeHourly ไม่ตรงกับวันที่ rollout)
      // absent → ครูได้ค่าตอบแทน 50% ที่บันทึกไว้ (computeEffectiveTeacherIncome จะได้ 0 เพราะ attendances=0)
      const effectiveTeacherIncome = isAbsent
        ? (s.absencePenalty.teacherCompensation || s.actualTeacherIncome || 0)
        : computeEffectiveTeacherIncome(s, attendances.length);

      // ── คำนวณ teacher income split (คลาสที่ Manager ยืนยัน 'completed' หรือนักเรียนขาด 'absent') ──
      if (s.status === 'completed' || s.status === 'absent') {
        const teacherRole = s.teacher?.role;
        if (teacherRole === 'manager') {
          kpiManagerIncome += effectiveTeacherIncome;
        } else if (teacherRole === 'teacher') {
          kpiTeacherExpense += effectiveTeacherIncome;
        }
        // role='admin' หรือไม่ระบุ → ไม่นับใน KPI ใดๆ
      }

      scheduleList.push({
        scheduleId:      s._id,
        date:            s.date,
        startTime:       s.startTime,
        endTime:         s.endTime,
        // ── Course metadata (full populate so consumers don't need a 2nd query) ──
        courseId:        s.course?._id || null,
        courseName:      s.course?.name || '-',
        subject:         s.course?.subject || '',
        type:            s.course?.type || null,            // 'group' | 'individual'
        gradeLevel:      s.course?.gradeLevel || '',
        teachingType:    s.course?.teachingType || '',
        description:     s.course?.description || '',
        // ── Teacher (id + display name + role) ──
        teacherId:       s.teacher?._id || null,
        teacherName:     s.teacher ? (s.teacher.nickname || `${s.teacher.firstName} ${s.teacher.lastName}`) : '-',
        teacherRole:     s.teacher?.role || null,
        // ── Confirmation state — same shape as /calendar ──
        teacherConfirmed:    s.teacherConfirmed || false,
        teacherConfirmedAt:  s.teacherConfirmedAt || null,
        isFullyConfirmed:    s.isFullyConfirmed || false,
        managerConfirmedBy:  s.managerConfirmedBy
                              ? (s.managerConfirmedBy.nickname || `${s.managerConfirmedBy.firstName} ${s.managerConfirmedBy.lastName}`)
                              : null,
        managerConfirmedAt:  s.managerConfirmedAt || null,
        totalDurationMinutes: s.totalDurationMinutes || 0,
        note:                s.note || null,
        // ── Per-student payment ──
        attendedStudents: (() => {
          const rows = attendances.map(att => {
            const key = `${att.student._id.toString()}:${sid}`;
            const payment = paymentByKey.get(key);
            // paymentStatus: 'unpaid' (ยังไม่ทำอะไร) | 'pending' (รอ Manager ยืนยัน) | 'confirmed' (ชำระสำเร็จ)
            const paymentStatus = payment ? payment.status : 'unpaid';
            return {
              studentId:    att.student._id,
              name:         att.student.nickname || `${att.student.firstName} ${att.student.lastName}`,
              scannedAt:    att.scannedAt,
              paymentStatus,
              paymentId:    payment?._id || null,
              // แสดงราคาปัจจุบันของคลาส ไม่ใช่ payment.amount เก่า — เพื่อให้ตรงกับหน้าอื่น
              paymentAmount: effectivePrice,
              quotedAmount: payment?.tuitionQuote ? payment.amount : null,
              isAbsent:      false
            };
          });
          // นักเรียนที่ขาดเรียน (no-show) — เพิ่มแถวค่าปรับ
          if (isAbsent && absentStudent) {
            const penaltyPayment = paymentByKey.get(`${absentStudentId}:${sid}`);
            rows.push({
              studentId:     absentStudent._id || absentStudent,
              name:          absentStudent.nickname || `${absentStudent.firstName || ''} ${absentStudent.lastName || ''}`.trim() || 'นักเรียน',
              scannedAt:     null,
              paymentStatus: penaltyPayment ? penaltyPayment.status : 'unpaid',
              paymentId:     penaltyPayment?._id || null,
              paymentAmount: penaltyAmount,
              isAbsent:      true
            });
          }
          return rows;
        })(),
        attendanceCount: attendances.length,
        coursePrice:     effectivePrice,
        // Raw rates from schedule — frontend uses these to render
        // "ชม.ละ X × Y ชม. = Z" formula when class date is past hourly cutoff
        coursePriceRaw:           s.coursePrice || 0,
        teacherIncomeIndividual:  s.teacherIncomeIndividual || 0,
        teacherIncomeGroup:       s.teacherIncomeGroup || 0,
        total:           totalForSchedule,
        paid:            paidForSchedule,
        unpaid:          totalForSchedule - paidForSchedule,
        status:          s.status,
        displayStatus:   deriveDisplayStatus(s),
        // นักเรียนขาดเรียน (no-show)
        isAbsent:        isAbsent,
        penaltyAmount:   penaltyAmount,
        // ใช้ค่าที่คำนวณใหม่ตาม date gate (ไม่พึ่ง flag เก่าที่อาจผิด)
        actualTeacherIncome: effectiveTeacherIncome
      });
    }

    sendResponse(res, 200, true, {
      kpi: {
        total: kpiTotal,
        paid: kpiPaid,
        unpaid: kpiTotal - kpiPaid,
        teacherExpense: kpiTeacherExpense,
        managerIncome:  kpiManagerIncome,
        netInstitute:   kpiTotal - kpiTeacherExpense - kpiManagerIncome  // กำไรสถาบัน = ยอดที่นักเรียนต้องจ่ายทั้งหมด − ค่าสอนครูทั้งสถาบัน (รวม Manager)
      },
      schedules: scheduleList
    }, 'Revenue report retrieved');
  } catch (error) {
    console.error('Revenue report error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Literal GET routes MUST be declared before '/:id' below, otherwise Express
// will match '/:id' first and attempt to cast the literal path to ObjectId.
// ────────────────────────────────────────────────────────────────────────────

// GET /teacher-payouts?month=YYYY-MM — รายการครูที่ชำระค่าจ้างแล้วในเดือนนั้น
router.get('/teacher-payouts', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { month } = req.query;
    const filter = {};
    if (month && /^\d{4}-\d{2}$/.test(String(month))) filter.month = month;
    const payouts = await TeacherPayout.find(filter)
      .populate('teacher', 'firstName lastName nickname')
      .populate('paidBy', 'firstName lastName nickname')
      .sort({ paidAt: -1 });
    sendResponse(res, 200, true, payouts, 'Teacher payouts retrieved');
  } catch (error) {
    console.error('Get teacher payouts error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// GET /bank-info — ดึงข้อมูลบัญชีธนาคารสำหรับโอน (แสดงให้นักเรียน)
router.get('/bank-info', authenticateToken, async (req, res) => {
  const bankName = process.env.BANK_NAME?.trim();
  const accountNumber = process.env.BANK_ACCOUNT_NUMBER?.trim();
  const accountName = process.env.BANK_ACCOUNT_NAME?.trim();
  if (!bankName || !accountNumber || !accountName) {
    return sendResponse(res, 503, false, null, 'โหลดข้อมูลบัญชีธนาคารไม่ได้');
  }
  sendResponse(res, 200, true, {
    bankName, accountNumber, accountName,
    promptpayId:   process.env.PROMPTPAY_ID        || ''
  }, 'Bank info retrieved');
});

router.get('/reconciliation', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const [legacyHolds, callbacks] = await Promise.all([
      listTuitionReviewHolds(),
      KBankReconciliation.find().sort({ receivedAt: -1 }).lean()
    ]);
    const recorded = await Payment.distinct('transactionRef', {
      method: 'gateway', status: 'confirmed', transactionRef: { $in: callbacks.map(callback => callback._id) }
    });
    const references = new Set(recorded);
    const bankCallbacks = callbacks.filter(callback => !references.has(callback._id));
    return sendResponse(res, 200, true, { legacyHolds, bankCallbacks }, 'Payment reconciliation');
  } catch (error) {
    console.error('Payment reconciliation error:', error);
    return sendResponse(res, 500, false, null, 'โหลดรายการกระทบยอดไม่สำเร็จ');
  }
});

// GET /pending-verification — Manager ดูรายการที่รอตรวจสอบ
router.get('/pending-verification', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const payments = await Payment.find({ status: 'pending' })
      .populate('student', 'firstName lastName nickname email phone')
      .populate('course', 'name subject')
      .populate({
        path: 'schedule',
        select: 'date startTime endTime coursePrice totalDurationMinutes status',
        populate: { path: 'course', select: 'name subject' }
      })
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, payments.map(payment => ({
      ...payment.toObject(),
      currentAmount: payment.schedule
        ? (payment.schedule.status === 'cancelled' ? 0 : computeEffectivePrice(payment.schedule)) : null
    })), 'Pending payments retrieved');
  } catch (error) {
    console.error('Pending verification error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// GET /my-status — นักเรียนดูสถานะการชำระของตัวเอง (รวม pending/confirmed)
router.get('/my-status', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const payments = await Payment.find({ student: req.user.id })
      .populate('course', 'name subject')
      .populate({
        path: 'schedule',
        select: 'date startTime endTime',
        populate: { path: 'course', select: 'name subject' }
      })
      .populate('confirmedBy', 'firstName lastName nickname')
      .sort({ createdAt: -1 });

    const resolved = await resolvePaymentCoverage(payments);
    sendResponse(res, 200, true, resolved.map(({ payment, scheduleIds }) => ({
      ...payment.toObject(), scheduleIds
    })), 'Payment statuses retrieved');
  } catch (error) {
    console.error('My status error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('student', 'firstName lastName nickname email phone')
      .populate('course', 'name price subject')
      .populate('confirmedBy', 'firstName lastName nickname');

    if (!payment) {
      return sendResponse(res, 404, false, null, 'Payment not found');
    }

    if (req.user.role === 'student' && payment.student._id.toString() !== req.user.id) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    sendResponse(res, 200, true, payment, 'Payment retrieved');
  } catch (error) {
    console.error('Get payment error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.put('/:id/confirm', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { note } = req.body;

    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      {
        status: 'confirmed',
        confirmedBy: req.user.id,
        note: note || null
      },
      { new: true, runValidators: true }
    ).populate('student', 'firstName lastName nickname email')
      .populate('course', 'name');

    if (!payment) {
      return sendResponse(res, 404, false, null, 'Payment not found');
    }

    const notification = new Notification({
      recipient: payment.student._id,
      sender: req.user.id,
      type: 'payment',
      title: 'Payment Confirmed',
      message: `Your payment of ${payment.amount} has been confirmed`,
      relatedId: payment._id
    });
    await notification.save();

    sendResponse(res, 200, true, payment, 'Payment confirmed');
  } catch (error) {
    console.error('Confirm payment error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.put('/:id/reject', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { note } = req.body;

    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      {
        status: 'rejected',
        note: note || null
      },
      { new: true, runValidators: true }
    ).populate('student', 'firstName lastName nickname email')
      .populate('course', 'name');

    if (!payment) {
      return sendResponse(res, 404, false, null, 'Payment not found');
    }

    const notification = new Notification({
      recipient: payment.student._id,
      sender: req.user.id,
      type: 'payment',
      title: 'Payment Rejected',
      message: `Your payment of ${payment.amount} has been rejected. Reason: ${note || 'No reason provided'}`,
      relatedId: payment._id
    });
    await notification.save();

    sendResponse(res, 200, true, payment, 'Payment rejected');
  } catch (error) {
    console.error('Reject payment error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /teacher-payout — Manager ยืนยันชำระค่าจ้างสอนให้ครู
// Body: { teacherId, amount, month: 'YYYY-MM' }
// ── upsert TeacherPayout (1 record ต่อ ครู × เดือน) + ส่ง Notification ──
// ────────────────────────────────────────────────────────────────────────────
router.post('/teacher-payout', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { teacherId, amount, month } = req.body;
    if (!teacherId || amount === undefined || amount === null || !month) {
      return sendResponse(res, 400, false, null, 'Missing required fields: teacherId, amount, month');
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return sendResponse(res, 400, false, null, 'Invalid month format (expected YYYY-MM)');
    }
    const teacher = await User.findById(teacherId).select('firstName lastName nickname role');
    if (!teacher || !['teacher', 'manager', 'admin'].includes(teacher.role)) {
      return sendResponse(res, 404, false, null, 'Teacher not found');
    }
    // กันซ้ำ: ถ้ามี payout เดือนนี้แล้ว → return existing
    const existing = await TeacherPayout.findOne({ teacher: teacherId, month });
    if (existing) {
      return sendResponse(res, 200, true, existing, 'Already paid for this month');
    }
    const payout = await TeacherPayout.create({
      teacher: teacherId,
      amount:  Number(amount),
      month,
      paidBy:  req.user.id
    });
    const monthLabel = new Date(`${month}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
    await Notification.create({
      recipient: teacher._id,
      sender:    req.user.id,
      type:      'general',
      title:     '💰 ชำระค่าจ้างสอนแล้ว',
      message:   `Manager ยืนยันชำระค่าจ้างสอน ${monthLabel} จำนวน ฿${Number(amount).toLocaleString('th-TH')} แล้ว`,
      relatedId: teacher._id
    });
    sendResponse(res, 200, true, payout, 'Teacher payout recorded');
  } catch (error) {
    console.error('Teacher payout error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /claim-transfer — นักเรียนยืนยันว่า "โอนเงินแล้ว" รอ Manager ตรวจสอบ
// Body: { scheduleId } หรือ { month: "YYYY-MM" }, transactionRef? (ref slip), note?
// ────────────────────────────────────────────────────────────────────────────
router.post('/claim-transfer', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const { created, ...claim } = await claimTuition(req.user.id, req.body);
    if (created) {
      try {
        const managers = await User.find({ role: { $in: ['manager', 'admin'] }, isActive: true });
        await Notification.insertMany(managers.map(manager => ({
          recipient: manager._id,
          sender: req.user.id,
          type: 'payment',
          title: 'มีการแจ้งชำระค่าเรียน',
          message: `ยอดที่แจ้งโอน ฿${claim.totalAmount.toLocaleString('th-TH')} กรุณาตรวจสอบ`,
          relatedId: claim.paymentIds[0]
        })));
      } catch (error) {
        console.error('Transfer claim notification failed:', error.message);
      }
    }
    sendResponse(res, created ? 201 : 200, true,
      { ...claim, status: 'pending', message: 'แจ้งว่าโอนแล้ว รอผู้จัดการตรวจสอบ' },
      'Transfer claimed');
  } catch (error) {
    if (!error.status) console.error('Claim transfer error:', error);
    sendResponse(res, error.status || 500, false, null, error.status
      ? error.message : 'ไม่สามารถบันทึกรายการแจ้งโอนได้');
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /manual-confirm — Manager/Admin ยืนยันชำระเงินของนักเรียนเอง
// (กรณีรับเงินสด/นอกระบบ ที่นักเรียนไม่ได้ claim-transfer ผ่านเว็บ)
// Body: { scheduleId, studentId }
// สร้าง Payment status='confirmed' ทันที, method='transfer', note='Manager confirm'
// ────────────────────────────────────────────────────────────────────────────
router.post('/manual-confirm', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { scheduleId, studentId } = req.body;

    if (!scheduleId || !studentId) {
      return sendResponse(res, 400, false, null, 'ต้องระบุ scheduleId และ studentId');
    }

    const schedule = await Schedule.findById(scheduleId).populate('course', 'name subject _id');
    if (!schedule) return sendResponse(res, 404, false, null, 'ไม่พบ schedule');

    const isStudent = schedule.students.some(s => s.toString() === studentId);
    if (!isStudent) return sendResponse(res, 400, false, null, 'นักเรียนไม่ได้ลงทะเบียนในคลาสนี้');

    // absent = คลาสปิดแล้ว (นักเรียนขาด) → ยืนยันชำระ "ค่าปรับ" ได้ ไม่ต้องมี attendance
    const isAbsent = schedule.status === 'absent';

    if (!isAbsent && !['completed', 'awaiting_confirmation'].includes(schedule.status)) {
      return sendResponse(res, 400, false, null, 'ยังไม่สามารถยืนยันได้: คลาสยังไม่เสร็จสิ้น');
    }

    if (isAbsent) {
      const penaltyStudentId = schedule.absencePenalty?.student?.toString();
      if (!penaltyStudentId || penaltyStudentId !== studentId) {
        return sendResponse(res, 400, false, null, 'นักเรียนคนนี้ไม่ได้ถูกทำเครื่องหมายขาดเรียนในคลาสนี้');
      }
    } else {
      const attended = await Attendance.findOne({ schedule: scheduleId, student: studentId });
      if (!attended) return sendResponse(res, 400, false, null, 'นักเรียนยังไม่ได้เช็คชื่อในคลาสนี้');
    }

    const existing = await Payment.findOne({
      student: studentId, schedule: scheduleId,
      status: { $in: ['pending', 'confirmed'] }
    });
    if (existing) {
      const msg = existing.status === 'confirmed'
        ? 'นักเรียนชำระเงินสำหรับคลาสนี้เรียบร้อยแล้ว'
        : 'คลาสนี้มีคำขอยืนยันการชำระอยู่แล้ว — ใช้ปุ่ม "ยืนยัน" ที่ payment ที่รออยู่';
      return sendResponse(res, 400, false, null, msg);
    }

    if (!schedule.course?._id) return sendResponse(res, 400, false, null, 'ไม่พบคอร์สที่เชื่อมโยง');
    const coverage = await getPaymentCoverage(studentId);
    if (coverage.blocked.has(String(scheduleId)) || (!isAbsent && onHold(coverage, thaiMonth(schedule.date)))) {
      return sendResponse(res, 409, false, null, 'มีหลักฐานชำระเดิม กรุณาตรวจสอบก่อนบันทึกรับเงิน');
    }

    // absent → เก็บ "ค่าปรับ" ที่บันทึกไว้ตอน mark-absent; ปกติ → ราคาคลาส
    const amount = (isAbsent ? (schedule.absencePenalty?.penaltyAmount || 0) : computeEffectivePrice(schedule)) || 0;

    const manager = await User.findById(req.user.id).select('nickname firstName');
    const managerNick = (manager?.nickname || manager?.firstName || 'unknown').trim();

    const payment = new Payment({
      student: studentId,
      course: schedule.course._id,
      schedule: scheduleId,
      paymentMonth: null,
      paymentType: 'per_class',
      amount,
      method: 'transfer',
      status: 'confirmed',
      confirmedBy: req.user.id,
      note: isAbsent
        ? `manager_${managerNick} ยืนยันชำระค่าปรับขาดเรียน (ไม่มี slip จากนักเรียน)`
        : `manager_${managerNick} ยืนยันเอง (ไม่มี slip จากนักเรียน)`
    });
    await payment.save();

    const subjectLabel = schedule.course?.subject || schedule.course?.name || 'คลาส';
    await Notification.create({
      recipient: studentId,
      sender: req.user.id,
      type: 'payment',
      title: '✅ ยืนยันการชำระเงิน',
      message: `Manager ได้บันทึกการชำระเงิน ${subjectLabel} ${new Date(schedule.date).toLocaleDateString('th-TH')} จำนวน ฿${amount.toLocaleString('th-TH')} แล้ว`,
      relatedId: payment._id
    });

    sendResponse(res, 201, true, payment, 'Payment confirmed manually');
  } catch (error) {
    console.error('Manual confirm error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /bulk-confirm-month — Manager/Admin ยืนยันการชำระทั้งเดือนของนักเรียน
// Body: { studentId, month: "YYYY-MM" }
// - คลาสที่มี Payment pending → update status=confirmed
// - คลาสที่ไม่มี Payment (unpaid) แต่ attended + completed → create Payment status=confirmed
// - คลาสที่ confirmed อยู่แล้ว → skip
// ────────────────────────────────────────────────────────────────────────────
router.post('/bulk-confirm-month', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { studentId, month } = req.body;
    if (!studentId || !month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return sendResponse(res, 400, false, null, 'ต้องระบุ studentId และ month (YYYY-MM)');
    }

    const [y, m] = month.split('-').map(Number);
    const startDate = new Date(y, m - 1, 1);
    const endDate   = new Date(y, m, 0, 23, 59, 59);
    const coverage = await getPaymentCoverage(studentId);
    if (onHold(coverage, month)) {
      return sendResponse(res, 409, false, null, 'มีหลักฐานชำระรายเดือนที่รอตรวจสอบ');
    }

    const schedules = await Schedule.find({
      students: studentId,
      date: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'awaiting_confirmation'] }
    }).populate('course', 'name subject _id');

    const manager = await User.findById(req.user.id).select('nickname firstName');
    const managerNick = (manager?.nickname || manager?.firstName || 'unknown').trim();
    const managerSelfNote = `manager_${managerNick} ยืนยันเอง (ไม่มี slip จากนักเรียน)`;
    const managerBulkNote = `manager_${managerNick} bulk confirm`;

    let confirmedFromPending = 0;
    let createdConfirmed = 0;
    let totalAmount = 0;
    const skippedNoAttendance = [];

    for (const s of schedules) {
      const attended = await Attendance.findOne({ schedule: s._id, student: studentId });
      if (!attended) {
        skippedNoAttendance.push(s._id);
        continue;
      }
      if (!s.course?._id) continue;

      const existing = await Payment.findOne({
        student: studentId,
        schedule: s._id,
        status: { $in: ['pending', 'confirmed'] }
      });

      if (existing) {
        if (existing.status === 'confirmed') continue;
        existing.status = 'confirmed';
        existing.confirmedBy = req.user.id;
        // นักเรียนได้แจ้งชำระมาแล้ว — ไม่ใช่ "manager ยืนยันเอง" ปกติ แค่บันทึก bulk action
        existing.note = existing.note ? `${existing.note} | ${managerBulkNote}` : managerBulkNote;
        await existing.save();
        confirmedFromPending++;
        totalAmount += existing.amount || 0;
      } else {
        if (coverage.blocked.has(String(s._id))) continue;
        const amount = computeEffectivePrice(s) || 0;
        const p = new Payment({
          student: studentId,
          course: s.course._id,
          schedule: s._id,
          paymentMonth: null,
          paymentType: 'per_class',
          amount,
          method: 'transfer',
          status: 'confirmed',
          confirmedBy: req.user.id,
          // unpaid → manager กดยืนยันเอง (ไม่มี slip)
          note: managerSelfNote
        });
        await p.save();
        createdConfirmed++;
        totalAmount += amount;
      }
    }

    const totalConfirmed = confirmedFromPending + createdConfirmed;
    if (totalConfirmed > 0) {
      await Notification.create({
        recipient: studentId,
        sender: req.user.id,
        type: 'payment',
        title: '✅ ยืนยันการชำระเงินรายเดือน',
        message: `Manager ได้ยืนยันการชำระเงินของคุณในเดือน ${month} จำนวน ${totalConfirmed} คลาส รวม ฿${totalAmount.toLocaleString('th-TH')}`,
      });
    }

    sendResponse(res, 200, true, {
      confirmedFromPending,
      createdConfirmed,
      totalConfirmed,
      totalAmount,
      skippedNoAttendance: skippedNoAttendance.length
    }, totalConfirmed > 0
        ? `ยืนยันการชำระสำเร็จ ${totalConfirmed} คลาส รวม ฿${totalAmount.toLocaleString('th-TH')}`
        : 'ไม่มีคลาสที่ต้องยืนยัน');
  } catch (error) {
    console.error('Bulk confirm month error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /generate-promptpay-qr — สร้าง PromptPay QR สำหรับชำระเงิน
// Body: { scheduleId } หรือ { month: "YYYY-MM" } (monthly payment)
// ────────────────────────────────────────────────────────────────────────────
router.post('/generate-promptpay-qr', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const student = req.user.id;
    const target = targetFilter(req.body);
    const { unpaid: rows, coverage, schedules } = await getTuitionDetails(student, target);
    const { resumeQuoteId } = req.body;
    if (resumeQuoteId && !mongoose.isObjectIdOrHexString(resumeQuoteId)) {
      return sendResponse(res, 400, false, null, 'รายการโอนเดิมไม่ถูกต้อง');
    }
    let quote = req.body.resume === true && await TuitionQuote.findOne({
      student, ...target, 'paymentIds.0': { $exists: false }, ...(resumeQuoteId && { _id: resumeQuoteId })
    }).sort({ createdAt: -1, _id: -1 });
    if (quote && !quoteMayBeClaimed(quote, coverage, schedules)) quote = null;
    if (resumeQuoteId && !quote) return sendResponse(res, 409, false, null, 'รายการโอนเดิมไม่พร้อมให้แจ้งโอนแล้ว');
    if (!quote && !rows.length) return sendResponse(res, 409, false, null, 'ไม่มียอดที่ชำระได้');
    const promptpayId = process.env.PROMPTPAY_ID;
    if (!promptpayId && !req.body.allowBankTransfer && !quote) {
      return sendResponse(res, 503, false, null, 'ระบบยังไม่พร้อมออก PromptPay QR');
    }
    if (!quote) quote = await TuitionQuote.create({
      student, ...target, items: quoteItems(rows), promptpayId
    });
    const stale = !quoteMatches(quote, rows) || (quote.promptpayId || '') !== (promptpayId || '');
    const amount = total(quote.items);
    const qrDataURL = promptpayId && !stale
      ? await QRCode.toDataURL(generatePayload(promptpayId, { amount }), { width: 320, errorCorrectionLevel: 'M' })
      : null;
    const relatedSchedules = quote.items.map(item => item.schedule);
    sendResponse(res, 200, true, {
      quoteId: quote._id, qrDataURL, amount, currentAmount: total(rows), stale, relatedSchedules,
      canRefresh: rows.length > 0,
      paymentType: target.month ? 'monthly' : 'per_class',
      description: target.month ? `ค่าเรียนเดือน ${target.month}`
        : (rows[0] ? `ค่าเรียน ${rows[0].subject || rows[0].courseName}` : 'ค่าเรียนรายคลาส')
    }, 'เรียกดูข้อมูลการโอนสำเร็จ');
  } catch (error) {
    if (!error.status) console.error('Generate PromptPay QR error:', error);
    sendResponse(res, error.status || 500, false, null, error.status ? error.message : 'ไม่สามารถออก QR ได้');
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /kbank/create-charge — สร้าง QR payment session + ส่งไปยัง KBank
// Body: { scheduleId } หรือ { month: "YYYY-MM" }
// ────────────────────────────────────────────────────────────────────────────
router.post('/kbank/create-charge', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const target = targetFilter(req.body);
    const { month } = target;
    const rows = await getTuition(req.user.id, target);
    // A paid legacy session may still exist even if no permanent receipt was written.
    const paidSessions = await PaymentSession.find({
      student: req.user.id, status: 'paid', scheduleIds: { $in: rows.map(row => row.scheduleId) }
    }).select('scheduleIds').lean();
    const paidIds = new Set(paidSessions.flatMap(session => session.scheduleIds.map(String)));
    const payable = rows.filter(row => !paidIds.has(String(row.scheduleId)));
    if (!payable.length) return sendResponse(res, 409, false, null, 'ไม่มียอดที่ชำระได้');
    const amount = Number(total(payable).toFixed(2));
    const relatedSchedules = payable.map(row => row.scheduleId);
    const courseId = payable[0].course;
    const paymentType = month ? 'monthly' : 'per_class';
    const description = month ? `ค่าเรียนรวมเดือน ${month} (${payable.length} คลาส)`
      : `ค่าเรียน ${payable[0].courseName}`;

    // สร้าง reference + เรียก KBank (หรือ fallback PromptPay)
    const reference = generateReference();
    const { qrDataURL, kbankTxnId, mode } = await createKBankCharge({ reference, amount, description });

    // บันทึก PaymentSession
    const session = await PaymentSession.create({
      student: req.user.id,
      course: courseId,
      scheduleIds: relatedSchedules,
      amount,
      paymentType,
      paymentMonth: month || null,
      reference,
      kbankTransactionId: kbankTxnId,
      qrDataURL,
      status: 'pending'
    });

    sendResponse(res, 200, true, {
      reference: session.reference,
      qrDataURL,
      amount,
      description,
      expiresAt: session.expiresAt,
      mode  // 'kbank' หรือ 'promptpay_fallback'
    }, 'สร้าง QR สำเร็จ');

  } catch (error) {
    if (error.status) return sendResponse(res, error.status, false, null, error.message);
    console.error('KBank create-charge error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /kbank/status/:reference — Frontend polling สถานะการชำระ
// ────────────────────────────────────────────────────────────────────────────
router.get('/kbank/status/:reference', authenticateToken, async (req, res) => {
  try {
    const session = await PaymentSession.findOne({ reference: req.params.reference });
    if (!session) return sendResponse(res, 404, false, null, 'Payment session not found');

    // QR expiry is a display state. Polling must not overwrite a bank settlement.
    const status = session.status === 'pending' && new Date() >= session.expiresAt ? 'expired' : session.status;

    sendResponse(res, 200, true, {
      reference: session.reference,
      status,
      amount: session.amount,
      paidAt: session.paidAt,
      expiresAt: session.expiresAt
    }, 'Payment status retrieved');
  } catch (error) {
    console.error('Payment status error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /kbank/webhook — รับ Webhook จาก KBank เมื่อชำระเงินสำเร็จ
// ⚠️  ไม่ใช้ authenticateToken — KBank ส่งโดยตรง
// ────────────────────────────────────────────────────────────────────────────
router.post('/kbank/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-kbank-signature'] || req.headers['x-signature'] || '';
    if (!verifyKBankSignature(req.body, signature)) {
      return sendResponse(res, 401, false, null, 'Invalid signature');
    }
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return sendResponse(res, 400, false, null, 'Invalid KBank payload');
    }
    const { partnerTxnRef: reference, kbankTxnId, paymentStatus, amount, currency, paidDt } = payload || {};
    if (typeof reference !== 'string' || !reference || !['success', 'failed'].includes(paymentStatus)) {
      return sendResponse(res, 400, false, null, 'Invalid KBank payment reference or status');
    }

    if (paymentStatus === 'failed') {
      await PaymentSession.updateOne({ reference, status: 'pending' }, { $set: { status: 'failed' } });
      return sendResponse(res, 200, true, null, 'KBank failure recorded');
    }
    const bankAmount = Number(amount);
    if (!['string', 'number'].includes(typeof amount) || !Number.isFinite(bankAmount) || bankAmount <= 0 || currency !== 'THB') {
      return sendResponse(res, 400, false, null, 'Invalid KBank payment amount or currency');
    }

    const charge = await PaymentSession.findOne({ reference }).lean();
    if (charge && (bankAmount !== Number(charge.amount.toFixed(2)) ||
      (charge.kbankTransactionId && charge.kbankTransactionId !== kbankTxnId))) {
      return sendResponse(res, 400, false, null, 'KBank payment does not match charge');
    }

    const bankDate = typeof paidDt === 'string' ? new Date(paidDt) : null;
    const paidAt = bankDate && Number.isFinite(bankDate.getTime()) ? bankDate : undefined;
    const settlingStates = ['pending', 'expired'];
    let payment;
    if (charge?.course && charge.scheduleIds.length && settlingStates.includes(charge.status)) {
      await mongoose.connection.transaction(async session => {
        payment = undefined;
        // The original charge and a matching signed success are valid after QR display expiry.
        const updated = await PaymentSession.updateOne({ _id: charge._id, status: { $in: settlingStates } }, {
          $set: { status: 'paid', paidAt: paidAt || new Date(), kbankTransactionId: kbankTxnId }
        }, { session });
        if (!updated.modifiedCount) return;
        [payment] = await Payment.create([{
          student: charge.student,
          course: charge.course,
          schedule: charge.scheduleIds[0],
          scheduleIds: charge.scheduleIds,
          paymentType: charge.paymentType,
          paymentMonth: charge.paymentMonth,
          amount: charge.amount,
          method: 'gateway',
          transactionRef: reference,
          status: 'confirmed',
          note: `KBank auto-verified. TxnId: ${kbankTxnId || ''}`
        }], { session });
      });
    }
    if (!payment && !await Payment.exists({ method: 'gateway', status: 'confirmed', transactionRef: reference })) {
      // The session TTL can remove the charge before a success arrives. Keep one review item per bank reference.
      await KBankReconciliation.updateOne({ _id: reference }, {
        $setOnInsert: { kbankTransactionId: kbankTxnId, amount: bankAmount, paidAt, student: charge?.student }
      }, { upsert: true });
      return sendResponse(res, 200, true, null, 'KBank success queued for reconciliation');
    }
    if (payment) {
      try {
        await Notification.create({
          recipient: charge.student,
          type: 'payment',
          title: '✅ ชำระเงินสำเร็จ',
          message: `ยืนยันการชำระเงิน ฿${charge.amount.toLocaleString()} เรียบร้อยแล้ว (Ref: ${reference})`,
          relatedId: payment._id
        });
      } catch (error) {
        console.error('[kbank-webhook] Notification failed:', error.message);
      }
    }
    return sendResponse(res, 200, true, null, 'KBank event acknowledged');
  } catch (error) {
    console.error('[kbank-webhook] Error:', error);
    return sendResponse(res, 500, false, null, 'Unable to record KBank payment');
  }
});

module.exports = router;
