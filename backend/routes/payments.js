const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const Payment = require('../models/Payment');
const PaymentSession = require('../models/PaymentSession');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Course = require('../models/Course');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject } = require('../utils/helpers');
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
  if (!KBANK_WEBHOOK_SECRET) return true; // ถ้ายังไม่ได้ตั้งค่า → ผ่าน (dev mode)
  const expected = crypto
    .createHmac('sha256', KBANK_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
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
    const Schedule = require('../models/Schedule');
    const Attendance = require('../models/Attendance');

    // หา schedules ที่นักเรียนเช็คชื่อแล้วแต่ยังไม่มี payment
    const attendances = await Attendance.find({ student: req.user.id })
      .populate({
        path: 'schedule',
        populate: { path: 'course', select: 'name subject' }
      });

    const unpaid = [];
    for (const att of attendances) {
      if (!att.schedule) continue;
      const existingPayment = await Payment.findOne({
        student: req.user.id,
        schedule: att.schedule._id,
        status: { $in: ['pending', 'confirmed'] }
      });
      if (!existingPayment) {
        unpaid.push({
          scheduleId: att.schedule._id,
          courseName: att.schedule.course?.name || '-',
          date: att.schedule.date,
          startTime: att.schedule.startTime,
          endTime: att.schedule.endTime,
          amount: att.schedule.coursePrice || 0,
          attendedAt: att.scannedAt
        });
      }
    }

    const totalAmount = unpaid.reduce((sum, item) => sum + item.amount, 0);
    sendResponse(res, 200, true, { unpaid, totalAmount }, 'Unpaid items retrieved');
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

    // กรอง schedule ที่เสร็จสิ้น (awaiting_confirmation หรือ completed)
    let scheduleQuery = {
      status: { $in: ['awaiting_confirmation', 'completed'] }
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
      .populate('course', 'name subject')
      .populate('teacher', 'firstName lastName nickname')
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

    // Batch 2: ดึง payments ของทุก schedule ในครั้งเดียว (รวม pending ด้วย)
    const allPayments = await Payment.find({
      schedule: { $in: scheduleIds },
      status: { $in: ['pending', 'confirmed'] }
    }).select('_id student schedule amount status');

    // สร้าง map: key = "studentId:scheduleId" → sum ของ amount (เฉพาะ confirmed)
    const paidAmountByKey = new Map();
    // สร้าง map: key = "studentId:scheduleId" → payment object (สำหรับสถานะล่าสุด)
    const paymentByKey = new Map();
    for (const p of allPayments) {
      const key = `${p.student.toString()}:${p.schedule.toString()}`;
      if (p.status === 'confirmed') {
        paidAmountByKey.set(key, (paidAmountByKey.get(key) || 0) + p.amount);
      }
      // เก็บ payment ล่าสุด (ใช้ confirmed > pending)
      const existing = paymentByKey.get(key);
      if (!existing || (existing.status === 'pending' && p.status === 'confirmed')) {
        paymentByKey.set(key, { _id: p._id, status: p.status, amount: p.amount });
      }
    }

    const scheduleList = [];
    let kpiTotal = 0, kpiPaid = 0;

    for (const s of schedules) {
      const sid = s._id.toString();
      const attendances = attendancesByScheduleId.get(sid) || [];

      // ถ้า filter studentId แล้วนักเรียนคนนั้นไม่ได้เข้าเรียน → ข้ามคลาสนี้
      if (studentId && attendances.length === 0) continue;

      const totalForSchedule = attendances.length * (s.coursePrice || 0);
      let paidForSchedule = 0;

      for (const att of attendances) {
        const key = `${att.student._id.toString()}:${sid}`;
        paidForSchedule += paidAmountByKey.get(key) || 0;
      }

      kpiTotal += totalForSchedule;
      kpiPaid  += paidForSchedule;

      scheduleList.push({
        scheduleId:      s._id,
        date:            s.date,
        startTime:       s.startTime,
        endTime:         s.endTime,
        courseName:      s.course?.name || '-',
        teacherId:       s.teacher?._id || null,
        teacherName:     s.teacher ? (s.teacher.nickname || `${s.teacher.firstName} ${s.teacher.lastName}`) : '-',
        attendedStudents: attendances.map(att => {
          const sid = s._id.toString();
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
            paymentAmount: payment?.amount || (s.coursePrice || 0)
          };
        }),
        attendanceCount: attendances.length,
        coursePrice:     s.coursePrice || 0,
        total:           totalForSchedule,
        paid:            paidForSchedule,
        unpaid:          totalForSchedule - paidForSchedule,
        status:          s.status,
        actualTeacherIncome: s.actualTeacherIncome || 0
      });
    }

    sendResponse(res, 200, true, {
      kpi: { total: kpiTotal, paid: kpiPaid, unpaid: kpiTotal - kpiPaid },
      schedules: scheduleList
    }, 'Revenue report retrieved');
  } catch (error) {
    console.error('Revenue report error:', error);
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
// GET /bank-info — ดึงข้อมูลบัญชีธนาคารสำหรับโอน (แสดงให้นักเรียน)
// ────────────────────────────────────────────────────────────────────────────
router.get('/bank-info', authenticateToken, async (req, res) => {
  sendResponse(res, 200, true, {
    bankName:      process.env.BANK_NAME          || 'ธนาคารกสิกรไทย (K-BANK)',
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '140-1-28661-2',
    accountName:   process.env.BANK_ACCOUNT_NAME   || 'น.ส. ณัฐบุษย์ เหมธนาพิพัฒน์',
    promptpayId:   process.env.PROMPTPAY_ID        || ''
  }, 'Bank info retrieved');
});

// ────────────────────────────────────────────────────────────────────────────
// POST /claim-transfer — นักเรียนยืนยันว่า "โอนเงินแล้ว" รอ Manager ตรวจสอบ
// Body: { scheduleId } หรือ { month: "YYYY-MM" }, transactionRef? (ref slip), note?
// ────────────────────────────────────────────────────────────────────────────
router.post('/claim-transfer', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const Schedule = require('../models/Schedule');
    const { scheduleId, month, transactionRef, note } = req.body;

    let amount = 0;
    let description = '';
    let paymentType = '';
    let relatedSchedules = [];
    let courseId = null;

    if (scheduleId) {
      // ── ชำระรายคลาส ──
      const schedule = await Schedule.findById(scheduleId).populate('course', 'name subject _id');
      if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

      const isStudent = schedule.students.some(s => s.toString() === req.user.id);
      if (!isStudent) return sendResponse(res, 403, false, null, 'คุณไม่ได้ลงทะเบียนในคลาสนี้');

      if (!['completed', 'awaiting_confirmation'].includes(schedule.status)) {
        return sendResponse(res, 400, false, null,
          `ยังไม่สามารถชำระเงินได้: ต้องรอครูยืนยันเสร็จสิ้นการสอนก่อน`);
      }

      const attended = await Attendance.findOne({ schedule: scheduleId, student: req.user.id });
      if (!attended) return sendResponse(res, 400, false, null, 'ยังไม่ได้เช็คชื่อในคลาสนี้');

      // ตรวจว่ามี payment pending/confirmed อยู่แล้วหรือไม่
      const existing = await Payment.findOne({
        student: req.user.id, schedule: scheduleId,
        status: { $in: ['pending', 'confirmed'] }
      });
      if (existing) {
        const msg = existing.status === 'confirmed'
          ? 'ชำระเงินสำหรับคลาสนี้เรียบร้อยแล้ว'
          : 'คลาสนี้มีคำขอยืนยันการชำระอยู่แล้ว — รอ Manager ตรวจสอบ';
        return sendResponse(res, 400, false, null, msg);
      }

      amount = schedule.coursePrice || 0;
      const subjectLabel = schedule.course?.subject || schedule.course?.name || 'คลาส';
      description = `ค่าเรียน ${subjectLabel} ${new Date(schedule.date).toLocaleDateString('th-TH')}`;
      paymentType = 'per_class';
      relatedSchedules = [scheduleId];
      courseId = schedule.course?._id;

    } else if (month) {
      // ── ชำระรายเดือน ──
      const [y, m] = month.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1);
      const endDate   = new Date(y, m, 0, 23, 59, 59);

      const schedules = await Schedule.find({
        students: req.user.id,
        date: { $gte: startDate, $lte: endDate },
        status: { $in: ['completed', 'awaiting_confirmation'] },
        coursePrice: { $gt: 0 }
      }).populate('course', 'name subject _id');

      for (const s of schedules) {
        const attended = await Attendance.findOne({ schedule: s._id, student: req.user.id });
        if (!attended) continue;
        const paid = await Payment.findOne({
          student: req.user.id, schedule: s._id,
          status: { $in: ['pending', 'confirmed'] }
        });
        if (!paid) {
          amount += s.coursePrice || 0;
          relatedSchedules.push(s._id.toString());
          if (!courseId && s.course?._id) courseId = s.course._id;
        }
      }

      if (amount === 0) return sendResponse(res, 400, false, null, 'ไม่มียอดค้างชำระในเดือนนี้');
      description = `ค่าเรียนรวมเดือน ${month} (${relatedSchedules.length} คลาส)`;
      paymentType = 'monthly';

    } else {
      return sendResponse(res, 400, false, null, 'ต้องระบุ scheduleId หรือ month');
    }

    if (!courseId) return sendResponse(res, 400, false, null, 'ไม่พบคอร์สที่เชื่อมโยง');

    // ── สร้าง Payment record ทุก schedule (ถ้าหลาย schedules) ──
    const createdPayments = [];
    for (const sid of relatedSchedules) {
      const sched = await Schedule.findById(sid);
      const p = new Payment({
        student: req.user.id,
        course: sched.course,
        schedule: sid,
        paymentMonth: paymentType === 'monthly' ? month : null,
        paymentType,
        amount: sched.coursePrice || 0,
        method: 'transfer',
        transactionRef: transactionRef || null,
        note: note || null,
        status: 'pending' // รอ Manager ยืนยัน
      });
      await p.save();
      createdPayments.push(p);
    }

    // ── แจ้ง Manager ──
    const managers = await User.find({ role: { $in: ['manager', 'admin'] }, isActive: true });
    for (const mgr of managers) {
      await Notification.create({
        recipient: mgr._id,
        sender: req.user.id,
        type: 'payment',
        title: '💰 มีการแจ้งยืนยันการชำระเงิน',
        message: `${description} — รวม ฿${amount.toLocaleString('th-TH')} | กรุณาตรวจสอบ`,
        relatedId: createdPayments[0]?._id
      });
    }

    sendResponse(res, 201, true, {
      paymentIds: createdPayments.map(p => p._id),
      totalAmount: amount,
      description,
      status: 'pending',
      message: 'แจ้งการชำระเงินสำเร็จ — รอ Manager ตรวจสอบและยืนยัน'
    }, 'Transfer claimed — awaiting verification');
  } catch (error) {
    console.error('Claim transfer error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /pending-verification — Manager ดูรายการที่รอตรวจสอบ
// ────────────────────────────────────────────────────────────────────────────
router.get('/pending-verification', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const payments = await Payment.find({ status: 'pending' })
      .populate('student', 'firstName lastName nickname email phone')
      .populate('course', 'name subject')
      .populate({
        path: 'schedule',
        select: 'date startTime endTime',
        populate: { path: 'course', select: 'name subject' }
      })
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, payments, 'Pending payments retrieved');
  } catch (error) {
    console.error('Pending verification error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /my-status — นักเรียนดูสถานะการชำระของตัวเอง (รวม pending/confirmed)
// ────────────────────────────────────────────────────────────────────────────
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

    sendResponse(res, 200, true, payments, 'Payment statuses retrieved');
  } catch (error) {
    console.error('My status error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /generate-promptpay-qr — สร้าง PromptPay QR สำหรับชำระเงิน
// Body: { scheduleId } หรือ { month: "YYYY-MM" } (monthly payment)
// ────────────────────────────────────────────────────────────────────────────
router.post('/generate-promptpay-qr', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const { scheduleId, month } = req.body;
    const promptpayId = process.env.PROMPTPAY_ID; // เบอร์โทรหรือเลขบัตรของระบบ

    if (!promptpayId) {
      return sendResponse(res, 500, false, null, 'PROMPTPAY_ID ยังไม่ได้ตั้งค่าใน .env');
    }

    let amount = 0;
    let description = '';
    let paymentType = '';
    let relatedSchedules = [];

    if (scheduleId) {
      // ── ชำระรายคลาส ──
      const schedule = await Schedule.findById(scheduleId)
        .populate('course', 'name subject');
      if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

      // ตรวจว่านักเรียนอยู่ใน schedule
      const isStudent = schedule.students.some(s => s.toString() === req.user.id);
      if (!isStudent) return sendResponse(res, 403, false, null, 'คุณไม่ได้ลงทะเบียนในคลาสนี้');

      // ตรวจ status: ชำระได้เฉพาะคลาสที่เสร็จสิ้น (รอ Manager ยืนยัน หรือเสร็จสิ้นแล้ว)
      if (!['completed', 'awaiting_confirmation'].includes(schedule.status)) {
        return sendResponse(res, 400, false, null,
          `ยังไม่สามารถชำระเงินได้: คลาสนี้สถานะ "${schedule.status}" ต้องรอครูยืนยันเสร็จสิ้นการสอนก่อน`);
      }

      // ตรวจว่าเช็คชื่อแล้ว
      const attended = await Attendance.findOne({ schedule: scheduleId, student: req.user.id });
      if (!attended) return sendResponse(res, 400, false, null, 'ยังไม่ได้เช็คชื่อในคลาสนี้');

      amount = schedule.coursePrice || 0;
      // ✅ ดึง subject จาก course (Schedule schema ไม่มี field subject)
      const subjectLabel = schedule.course?.subject || schedule.course?.name || 'คลาส';
      description = `ค่าเรียน ${subjectLabel} ${new Date(schedule.date).toLocaleDateString('th-TH')}`;
      paymentType = 'per_class';
      relatedSchedules = [scheduleId];

    } else if (month) {
      // ── ชำระรายเดือน ──
      const [y, m] = month.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1);
      const endDate   = new Date(y, m, 0, 23, 59, 59);

      // หา schedules ของนักเรียนในเดือนนั้นที่ completed/awaiting_confirmation
      const schedules = await Schedule.find({
        students: req.user.id,
        date: { $gte: startDate, $lte: endDate },
        status: { $in: ['completed', 'awaiting_confirmation'] },
        coursePrice: { $gt: 0 }
      });

      // กรองเฉพาะที่เช็คชื่อแล้วและยังไม่ได้จ่าย
      for (const s of schedules) {
        const attended = await Attendance.findOne({ schedule: s._id, student: req.user.id });
        if (!attended) continue;
        const paid = await Payment.findOne({
          student: req.user.id, schedule: s._id,
          status: { $in: ['pending', 'confirmed'] }
        });
        if (!paid) {
          amount += s.coursePrice || 0;
          relatedSchedules.push(s._id.toString());
        }
      }

      if (amount === 0) return sendResponse(res, 400, false, null, 'ไม่มียอดค้างชำระในเดือนนี้');
      description = `ค่าเรียนรวมเดือน ${month} (${relatedSchedules.length} คลาส)`;
      paymentType = 'monthly';
    } else {
      return sendResponse(res, 400, false, null, 'ต้องระบุ scheduleId หรือ month');
    }

    if (amount <= 0) return sendResponse(res, 400, false, null, 'ยอดชำระต้องมากกว่า 0');

    // สร้าง PromptPay payload
    const payload = generatePayload(promptpayId, { amount });
    const qrDataURL = await QRCode.toDataURL(payload);

    sendResponse(res, 200, true, {
      qrDataURL,
      amount,
      description,
      paymentType,
      relatedSchedules,
      promptpayId
    }, 'สร้าง PromptPay QR สำเร็จ');
  } catch (error) {
    console.error('Generate PromptPay QR error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /kbank/create-charge — สร้าง QR payment session + ส่งไปยัง KBank
// Body: { scheduleId } หรือ { month: "YYYY-MM" }
// ────────────────────────────────────────────────────────────────────────────
router.post('/kbank/create-charge', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const { scheduleId, month } = req.body;
    let amount = 0;
    let description = '';
    let paymentType = '';
    let relatedSchedules = [];
    let courseId = null;

    if (scheduleId) {
      // ── ชำระรายคลาส ──────────────────────────────────────────────────────
      const schedule = await Schedule.findById(scheduleId).populate('course', 'name subject _id');
      if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

      const isStudent = schedule.students.some(s => s.toString() === req.user.id);
      if (!isStudent) return sendResponse(res, 403, false, null, 'คุณไม่ได้ลงทะเบียนในคลาสนี้');

      // ตรวจ status: ชำระได้เฉพาะคลาสที่เสร็จสิ้นการสอนแล้ว
      if (!['completed', 'awaiting_confirmation'].includes(schedule.status)) {
        return sendResponse(res, 400, false, null,
          `ยังไม่สามารถชำระเงินได้: คลาสนี้สถานะ "${schedule.status}" ต้องรอครูยืนยันเสร็จสิ้นการสอนก่อน`);
      }

      const attended = await Attendance.findOne({ schedule: scheduleId, student: req.user.id });
      if (!attended) return sendResponse(res, 400, false, null, 'ยังไม่ได้เช็คชื่อในคลาสนี้');

      // ตรวจว่าจ่ายไปแล้วหรือยัง
      const existingSession = await PaymentSession.findOne({
        student: req.user.id,
        scheduleIds: scheduleId,
        status: { $in: ['pending', 'paid'] }
      });
      if (existingSession?.status === 'paid') {
        return sendResponse(res, 400, false, null, 'ชำระเงินสำหรับคลาสนี้แล้ว');
      }

      amount = schedule.coursePrice || 0;
      description = `ค่าเรียน ${schedule.course?.name || 'คลาส'} ${new Date(schedule.date).toLocaleDateString('th-TH')}`;
      paymentType = 'per_class';
      relatedSchedules = [scheduleId];
      courseId = schedule.course?._id || null;

    } else if (month) {
      // ── ชำระรายเดือน ──────────────────────────────────────────────────────
      const [y, m] = month.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1);
      const endDate   = new Date(y, m, 0, 23, 59, 59);

      const schedules = await Schedule.find({
        students: req.user.id,
        date: { $gte: startDate, $lte: endDate },
        status: { $in: ['completed', 'awaiting_confirmation'] },
        coursePrice: { $gt: 0 }
      });

      for (const s of schedules) {
        const attended = await Attendance.findOne({ schedule: s._id, student: req.user.id });
        if (!attended) continue;
        const paidSession = await PaymentSession.findOne({
          student: req.user.id,
          scheduleIds: s._id,
          status: 'paid'
        });
        if (!paidSession) {
          amount += s.coursePrice || 0;
          relatedSchedules.push(s._id.toString());
          if (!courseId) courseId = s.course;
        }
      }

      if (amount === 0) return sendResponse(res, 400, false, null, 'ไม่มียอดค้างชำระในเดือนนี้');
      description = `ค่าเรียนรวมเดือน ${month} (${relatedSchedules.length} คลาส)`;
      paymentType = 'monthly';
    } else {
      return sendResponse(res, 400, false, null, 'ต้องระบุ scheduleId หรือ month');
    }

    if (amount <= 0) return sendResponse(res, 400, false, null, 'ยอดชำระต้องมากกว่า 0');

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

    // ตรวจว่า expired หรือยัง
    if (session.status === 'pending' && new Date() > session.expiresAt) {
      session.status = 'expired';
      await session.save();
    }

    sendResponse(res, 200, true, {
      reference: session.reference,
      status: session.status,  // pending | paid | failed | expired
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
    // ── 1. ตรวจสอบ KBank Signature ──────────────────────────────────────────
    const signature = req.headers['x-kbank-signature'] || req.headers['x-signature'] || '';
    const rawBody = req.body; // Buffer (จาก express.raw)

    if (!verifyKBankSignature(rawBody, signature)) {
      console.warn('[kbank-webhook] Invalid signature');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody.toString());
    console.log('[kbank-webhook] Received:', JSON.stringify(payload));

    // ── 2. แปลง payload จาก KBank ─────────────────────────────────────────
    // KBank Webhook Payload format:
    // {
    //   "partnerTxnRef": "KMS-...",   ← reference ของเรา
    //   "kbankTxnId":   "...",        ← KBank transaction ID
    //   "amount":       "100.00",
    //   "currency":     "THB",
    //   "paymentStatus": "success",   ← success | failed
    //   "paidDt":       "2024-01-01T10:00:00+07:00"
    // }
    const reference    = payload.partnerTxnRef;
    const kbankTxnId   = payload.kbankTxnId;
    const payStatus    = payload.paymentStatus; // 'success' or 'failed'

    if (!reference) {
      return res.status(400).json({ success: false, message: 'Missing partnerTxnRef' });
    }

    // ── 3. ค้นหา PaymentSession ─────────────────────────────────────────────
    const session = await PaymentSession.findOne({ reference });
    if (!session) {
      console.warn(`[kbank-webhook] Session not found: ${reference}`);
      return res.status(200).json({ success: true }); // ตอบ 200 เสมอให้ KBank ไม่ retry
    }

    if (session.status !== 'pending') {
      return res.status(200).json({ success: true }); // processed แล้ว
    }

    // ── 4. อัปเดตสถานะ ───────────────────────────────────────────────────────
    if (payStatus === 'success') {
      session.status = 'paid';
      session.paidAt = new Date();
      session.kbankTransactionId = kbankTxnId;
      await session.save();

      // สร้าง Payment record ถาวร (สำหรับ records/reporting)
      const payment = await Payment.create({
        student: session.student,
        course: session.course,
        schedule: session.scheduleIds?.[0] || null,
        paymentType: session.paymentType,
        paymentMonth: session.paymentMonth,
        amount: session.amount,
        method: 'gateway',
        transactionRef: reference,
        status: 'confirmed',
        confirmedBy: null,
        note: `KBank auto-verified. TxnId: ${kbankTxnId}`
      });

      // แจ้งเตือนนักเรียน
      await Notification.create({
        recipient: session.student,
        sender: null,
        type: 'payment',
        title: '✅ ชำระเงินสำเร็จ',
        message: `ยืนยันการชำระเงิน ฿${session.amount.toLocaleString()} เรียบร้อยแล้ว (Ref: ${reference})`,
        relatedId: payment._id
      });

      console.log(`[kbank-webhook] Payment confirmed: ${reference} | ฿${session.amount}`);

    } else {
      session.status = 'failed';
      await session.save();
      console.log(`[kbank-webhook] Payment failed: ${reference}`);
    }

    // ── 5. ตอบ KBank 200 เสมอ ────────────────────────────────────────────────
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('[kbank-webhook] Error:', error);
    res.status(200).json({ success: true }); // ตอบ 200 เสมอ ไม่งั้น KBank จะ retry
  }
});

module.exports = router;
