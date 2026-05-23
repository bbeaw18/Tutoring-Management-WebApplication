const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { connectDB } = require('./config/db');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const coursesRoutes = require('./routes/courses');
const enrollmentsRoutes = require('./routes/enrollments');
const paymentsRoutes = require('./routes/payments');
const videosRoutes = require('./routes/videos');
const schedulesRoutes = require('./routes/schedules');
const notificationsRoutes = require('./routes/notifications');
const attendanceRoutes = require('./routes/attendance');
const expensesRoutes = require('./routes/expenses');

const app = express();

connectDB();

app.use(helmet());

// ── CORS: รองรับหลาย origins (dev + production)
//    ตั้งค่าใน .env เป็น comma-separated list:
//      CORS_ORIGIN=http://localhost:4200,https://your-app.vercel.app
//    หรือใส่ "*" เพื่ออนุญาตทั้งหมด (ไม่แนะนำ production) ──
const corsOriginEnv = process.env.CORS_ORIGIN || 'http://localhost:4200';
const allowedOrigins = corsOriginEnv.split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // อนุญาต requests ไม่มี origin (Postman, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // อนุญาต Vercel preview deployments อัตโนมัติ (*.vercel.app)
    if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true
}));

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting — แยกเป็น 2 ตัว
//   authLimiter    → /api/auth/login, /register, /verify-totp (กัน brute force)
//   generalLimiter → route อื่น ๆ ทั้งหมด (กัน abuse แต่ไม่รบกวน SPA ปกติ)
// ใน development mode จะ skip ทั้งหมด เพื่อไม่ให้ UI เพี้ยนเวลากำลังพัฒนา
// ─────────────────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,                        // 20 ครั้ง/15 นาที — เฉพาะ endpoints ที่เกี่ยวกับ authen
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev               // ปิดใน dev
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,                      // 1000 ครั้ง/15 นาที — เพียงพอสำหรับ SPA ที่ polling
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev               // ปิดใน dev
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/uploads', express.static('uploads'));

// Apply general limiter ให้ทุก API
app.use('/api', generalLimiter);

// Auth routes ใช้ authLimiter เฉพาะ endpoints ที่ login/register/OTP
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/verify-totp', authLimiter);
app.use('/api/auth/verify-totp-setup', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/enrollments', enrollmentsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/videos', videosRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/expenses', expensesRoutes);

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Cron Job: ทุกวันที่ 3 ของเดือน — แจ้งเตือนชำระเงินค้าง
// ────────────────────────────────────────────────────────────────────────────
async function runPaymentReminderJob() {
  console.log('[Cron] เริ่ม payment reminder job...');
  try {
    const Payment = require('./models/Payment');
    const Attendance = require('./models/Attendance');
    const User = require('./models/User');
    const Schedule = require('./models/Schedule');
    const { sendPaymentReminderEmail } = require('./services/emailService');
    const { computeEffectivePrice } = require('./utils/helpers');

    // หานักเรียนทั้งหมดที่มีการเช็คชื่อ
    const students = await User.find({ role: 'student', isActive: true });

    for (const student of students) {
      const attendances = await Attendance.find({ student: student._id })
        .populate({
          path: 'schedule',
          populate: { path: 'course', select: 'name subject' }
        });

      const unpaid = [];
      for (const att of attendances) {
        if (!att.schedule) continue;
        const existingPayment = await Payment.findOne({
          student: student._id,
          schedule: att.schedule._id,
          status: { $in: ['pending', 'confirmed'] }
        });
        if (!existingPayment && att.schedule.coursePrice > 0) {
          unpaid.push({
            courseName: att.schedule.course?.name || '-',
            dateText: new Date(att.schedule.date).toLocaleDateString('th-TH'),
            amount: computeEffectivePrice(att.schedule)
          });
        }
      }

      if (unpaid.length > 0) {
        const totalAmount = unpaid.reduce((sum, item) => sum + item.amount, 0);
        await sendPaymentReminderEmail({
          studentEmail: student.email,
          studentName: `${student.firstName} ${student.lastName}`,
          unpaidItems: unpaid,
          totalAmount
        });
        console.log(`[Cron] ส่งแจ้งเตือนชำระเงินไปยัง ${student.email} (${unpaid.length} รายการ)`);
      }
    }
  } catch (error) {
    console.error('[Cron] Payment reminder error:', error);
  }
}

// M3: ตรวจสอบทุก 1 ชม. ว่าถึงวันที่ 3 หรือยัง (ใช้ Bangkok UTC+7 ไม่ใช่ server local time)
// ป้องกันกรณี deploy บน server ที่ timezone เป็น UTC — cron จะรันเวลาผิด
let lastPaymentReminderRun = null;   // 'YYYY-MM' — กันรันซ้ำในเดือนเดียวกัน
setInterval(() => {
  const nowUTC = new Date();
  const bangkok = new Date(nowUTC.getTime() + 7 * 60 * 60 * 1000);  // UTC + 7 hours
  const bkkDate  = bangkok.getUTCDate();
  const bkkHours = bangkok.getUTCHours();
  const bkkYM    = `${bangkok.getUTCFullYear()}-${String(bangkok.getUTCMonth() + 1).padStart(2, '0')}`;

  // วันที่ 3 ของเดือน เวลา 09:00 (Bangkok) — รันครั้งเดียวต่อเดือน
  if (bkkDate === 3 && bkkHours === 9 && lastPaymentReminderRun !== bkkYM) {
    lastPaymentReminderRun = bkkYM;
    console.log(`[Cron] Running payment reminder for ${bkkYM} (Bangkok time)`);
    runPaymentReminderJob();
  }
}, 60 * 60 * 1000);

// ────────────────────────────────────────────────────────────────────────────
// Cron Job: ทุก 5 นาที — Auto-complete คลาสที่หมดเวลา QR (+30 นาที)
// ────────────────────────────────────────────────────────────────────────────
async function autoCompleteExpiredSchedules() {
  try {
    const Schedule     = require('./models/Schedule');
    const Attendance   = require('./models/Attendance');
    const User         = require('./models/User');
    const Notification = require('./models/Notification');
    const { sendManagerClassCompletedEmail } = require('./services/emailService');
    const { computeEffectivePrice } = require('./utils/helpers');

    const now = new Date();

    // ดึง schedule ที่ยังไม่ completed/cancelled/awaiting_confirmation
    // ✅ populate course เพื่อให้ดึง subject/name ได้สำหรับ notification message
    const candidates = await Schedule.find({
      status: { $in: ['confirmed', 'scheduled', 'pending'] }
    }).populate('teacher', 'firstName lastName email')
      .populate('students', 'firstName lastName email')
      .populate('course', 'name subject');

    const bangkokTime = (scheduleDate, timeStr) => {
      const d = new Date(scheduleDate);
      const dateStr = new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
      return new Date(`${dateStr}T${timeStr}:00+07:00`);
    };

    for (const schedule of candidates) {
      const classEnd  = bangkokTime(schedule.date, schedule.endTime);
      const deadline  = new Date(classEnd.getTime() + 30 * 60 * 1000);
      if (now <= deadline) continue;

      // ── ปิด QR (ถ้ายังเปิดอยู่) ทันทีที่เลยเวลา ──
      if (schedule.qrActive) {
        schedule.qrActive = false;
      }

      // ── ตรวจว่ามีการเช็คชื่อจริงหรือไม่ ──
      // ถ้าครูไม่เคยเปิด QR หรือไม่มีนักเรียนเช็คชื่อ → ไม่ควรไป awaiting_confirmation
      // (ครูต้องเป็นคนกด "ยืนยันเสร็จสิ้นการสอน" เองเท่านั้น)
      const attendanceCount = await Attendance.countDocuments({ schedule: schedule._id });
      if (attendanceCount === 0) {
        // เซฟเฉพาะถ้ามีการเปลี่ยน qrActive เพื่อกัน save spam
        if (schedule.isModified()) await schedule.save();
        console.log(`[AutoComplete] ⏭ ข้าม ${schedule._id} (ไม่มีการเช็คชื่อ — รอครูกดยืนยันเอง)`);
        continue;
      }

      console.log(`[AutoComplete] กำลังเปลี่ยนเป็น awaiting_confirmation: ${schedule._id}`);

      // คำนวณรายได้เบื้องต้น (ยังไม่บันทึก hours) — ใช้ date-gate
      // คลาสตั้งแต่ TEACHER_HOURLY_FROM (8 พ.ค. 2569) → rate × hours
      // ก่อนหน้านั้น → flat rate
      const { computeEffectiveTeacherIncome } = require('./utils/helpers');
      schedule.actualTeacherIncome = computeEffectiveTeacherIncome(schedule, attendanceCount);

      // รอ manager ยืนยัน — ยังไม่บันทึก hours
      schedule.status = 'awaiting_confirmation';
      await schedule.save();

      // ✅ ดึง subject จาก course (Schedule schema ไม่มี field subject)
      const subjectName  = schedule.course?.subject || schedule.course?.name || '';
      const teacherName  = schedule.teacher ? `${schedule.teacher.firstName} ${schedule.teacher.lastName}` : 'ไม่ระบุ';
      const dateText     = new Date(schedule.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeText     = `${schedule.startTime} – ${schedule.endTime} น.`;
      const teacherIncome = schedule.actualTeacherIncome || 0;
      const coursePrice   = computeEffectivePrice(schedule);

      // แจ้ง in-app: ครู
      if (schedule.teacher) {
        await Notification.create({
          recipient: schedule.teacher._id, type: 'general',
          title: '⏳ คลาสรอยืนยัน',
          message: `คลาส${subjectName ? ' ' + subjectName : ''} วันที่ ${dateText} ${timeText} มีนักเรียนเช็คชื่อ ${attendanceCount} คน — รอ Manager ยืนยัน`
        });
      }

      // แจ้ง in-app + email: Manager
      const managers = await User.find({ role: 'manager', isActive: true }).select('_id email');
      for (const mgr of managers) {
        await Notification.create({
          recipient: mgr._id, type: 'general',
          title: '📋 คลาสรอยืนยัน — กรุณาตรวจสอบ',
          message: `คลาส${subjectName ? ' ' + subjectName : ''} ครู: ${teacherName} | ${dateText} ${timeText} | เช็คชื่อ ${attendanceCount}/${schedule.students.length} คน | รายได้ครู ฿${teacherIncome.toLocaleString('th-TH')}`
        });
      }
      const managerEmails = managers.map(m => m.email).filter(Boolean);
      if (managerEmails.length > 0) {
        // await + catch — เพื่อให้ error ถูก log และไม่สูญหาย
        // แต่ error ของ email ไม่ควร block การทำงาน cron อื่น ๆ
        try {
          await sendManagerClassCompletedEmail({
            managerEmails, teacherName, subjectName, dateText, timeText,
            attendanceCount, totalStudents: schedule.students.length,
            teacherIncome, coursePrice
          });
        } catch (emailErr) {
          console.error('[AutoComplete] Email error (non-blocking):', emailErr.message);
        }
      }

      console.log(`[AutoComplete] ✅ awaiting_confirmation: ${schedule._id}`);
    }
  } catch (error) {
    console.error('[AutoComplete] Error:', error);
  }
}

// รันทันทีเมื่อ server เริ่ม (เผื่อมี schedule ค้างอยู่) และทุก 5 นาที
autoCompleteExpiredSchedules();
setInterval(autoCompleteExpiredSchedules, 5 * 60 * 1000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('[Server] Attendance routes registered at /api/attendance');
  console.log('[Server] Payment reminder cron job scheduled for day 3 of each month at 09:00');
  console.log('[Server] Auto-complete cron job running every 5 minutes');
});
