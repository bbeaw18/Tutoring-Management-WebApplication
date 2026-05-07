const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Schedule = require('../models/Schedule');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse } = require('../utils/helpers');

// Bangkok UTC+7 helper
function bangkokClassTime(scheduleDate, timeStr) {
  const d = new Date(scheduleDate);
  const dateStr = new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  return new Date(`${dateStr}T${timeStr}:00+07:00`);
}

// ────────────────────────────────────────────────────────────────────────────
// POST /scan — นักเรียนสแกน QR เพื่อเช็คชื่อ
// Body: { scheduleId, token }
// ────────────────────────────────────────────────────────────────────────────
router.post('/scan', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const { scheduleId, token } = req.body;

    if (!scheduleId || !token) {
      return sendResponse(res, 400, false, null, 'scheduleId and token required');
    }

    const schedule = await Schedule.findById(scheduleId)
      .populate('course', 'name')
      .populate('teacher', 'firstName lastName nickname');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    // ตรวจสอบว่า QR active
    if (!schedule.qrActive) {
      return sendResponse(res, 400, false, null, 'QR code is not active');
    }

    // ตรวจสอบ token
    if (schedule.qrToken !== token) {
      return sendResponse(res, 400, false, null, 'Invalid QR token');
    }

    // ── ตรวจสอบหน้าต่างเวลา (Bangkok UTC+7): สแกนได้ช่วงเวลาคลาส + 30 นาที ──
    const now = new Date();
    const classStart  = bangkokClassTime(schedule.date, schedule.startTime);
    const classEnd    = bangkokClassTime(schedule.date, schedule.endTime);
    const scanDeadline = new Date(classEnd.getTime() + 30 * 60 * 1000);

    if (now < classStart) {
      return sendResponse(res, 400, false, null, `ยังไม่ถึงเวลาเรียน สามารถเช็คชื่อได้ตั้งแต่ ${schedule.startTime} น.`);
    }
    if (now > scanDeadline) {
      return sendResponse(res, 400, false, null, `หมดเวลาเช็คชื่อแล้ว (รับได้ถึง ${schedule.endTime} น. + 30 นาที)`);
    }

    // ตรวจสอบ expire (QR token level)
    if (schedule.qrExpiresAt && now > schedule.qrExpiresAt) {
      return sendResponse(res, 400, false, null, 'QR code has expired');
    }

    // ตรวจสอบว่านักเรียนอยู่ใน schedule
    const isStudent = schedule.students.some(s => s.toString() === req.user.id);
    if (!isStudent) {
      return sendResponse(res, 403, false, null, 'You are not enrolled in this class');
    }

    // บันทึก attendance (unique index จะป้องกันสแกนซ้ำ)
    const attendance = new Attendance({
      schedule: scheduleId,
      student: req.user.id,
      deviceInfo: req.headers['user-agent'] || null
    });

    await attendance.save();

    const student = await User.findById(req.user.id).select('firstName lastName profileImage');

    sendResponse(res, 201, true, {
      student: {
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        profileImage: student.profileImage
      },
      scannedAt: attendance.scannedAt,
      courseName: schedule.course?.name
    }, 'Attendance recorded');
  } catch (error) {
    if (error.code === 11000) {
      return sendResponse(res, 409, false, null, 'Already checked in for this class');
    }
    console.error('Scan attendance error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /manual-add — Admin เพิ่มนักเรียนเข้าเรียนด้วยตนเอง (เพื่อทดสอบระบบ)
// Body: { scheduleId, studentId }
// ────────────────────────────────────────────────────────────────────────────
router.post('/manual-add', authenticateToken, roleCheck(['admin']), async (req, res) => {
  try {
    const { scheduleId, studentId } = req.body;

    if (!scheduleId || !studentId) {
      return sendResponse(res, 400, false, null, 'scheduleId และ studentId จำเป็นต้องระบุ');
    }

    const schedule = await Schedule.findById(scheduleId).populate('course', 'name');
    if (!schedule) return sendResponse(res, 404, false, null, 'ไม่พบคลาส');

    const student = await User.findById(studentId).select('firstName lastName nickname profileImage role');
    if (!student) return sendResponse(res, 404, false, null, 'ไม่พบนักเรียน');
    if (student.role !== 'student') {
      return sendResponse(res, 400, false, null, 'ผู้ใช้ที่เลือกไม่ใช่นักเรียน');
    }

    // ตรวจสอบว่านักเรียนถูกการนัดสอนในคลาสนี้
    const isEnrolled = schedule.students.some(s => s.toString() === studentId);
    if (!isEnrolled) {
      return sendResponse(res, 400, false, null, 'นักเรียนคนนี้ไม่ได้ถูกการนัดสอนในคลาสนี้');
    }

    // บันทึก attendance (unique index ป้องกันซ้ำ)
    const attendance = new Attendance({
      schedule: scheduleId,
      student:  studentId,
      deviceInfo: `manual-admin:${req.user.id}`
    });

    await attendance.save();

    sendResponse(res, 201, true, {
      student: {
        _id:          student._id,
        firstName:    student.firstName,
        lastName:     student.lastName,
        nickname:     student.nickname,
        profileImage: student.profileImage
      },
      scannedAt:  attendance.scannedAt,
      courseName: schedule.course?.name
    }, 'เพิ่มการเข้าเรียนสำเร็จ');
  } catch (error) {
    if (error.code === 11000) {
      return sendResponse(res, 409, false, null, 'นักเรียนคนนี้เช็คชื่อในคลาสนี้แล้ว');
    }
    console.error('Manual add attendance error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /schedule/:scheduleId — ดูรายชื่อผู้เช็คชื่อ (teacher/manager)
// ────────────────────────────────────────────────────────────────────────────
router.get('/schedule/:scheduleId', authenticateToken, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.scheduleId).populate('teacher', 'firstName lastName nickname');
    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    const isTeacher = schedule.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);

    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    const attendances = await Attendance.find({ schedule: req.params.scheduleId })
      .populate('student', 'firstName lastName nickname profileImage email')
      .sort({ scannedAt: 1 });

    sendResponse(res, 200, true, attendances, 'Attendances retrieved');
  } catch (error) {
    console.error('Get attendance error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /my — ประวัติการเช็คชื่อของนักเรียน (history)
// รวม paymentStatus: 'paid' | 'pending' | 'unpaid' ต่อแต่ละ schedule
// ────────────────────────────────────────────────────────────────────────────
router.get('/my', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const attendances = await Attendance.find({ student: req.user.id })
      .populate({
        path: 'schedule',
        populate: [
          { path: 'course', select: 'name subject' },
          { path: 'teacher', select: 'firstName lastName' }
        ]
      })
      .sort({ scannedAt: -1 });

    // H5: เปลี่ยนจาก N+1 queries (findOne ต่อ record) → 1 query ดึงรวมกัน
    // ดึง schedule IDs ทั้งหมดแล้ว query payment ทีเดียวด้วย $in
    const scheduleIds = attendances
      .map(a => a.schedule?._id)
      .filter(Boolean);

    const payments = await Payment.find({
      student: req.user.id,
      schedule: { $in: scheduleIds }
    }).select('schedule status createdAt').sort({ createdAt: -1 });

    // สร้าง map: scheduleId → latest payment (เรียงตาม createdAt desc แล้ว)
    const paymentByScheduleId = new Map();
    for (const p of payments) {
      const sid = p.schedule.toString();
      if (!paymentByScheduleId.has(sid)) {
        paymentByScheduleId.set(sid, p);  // เก็บเฉพาะอันแรก = ใหม่ที่สุด
      }
    }

    const result = attendances.map(att => {
      const attObj = att.toObject();
      if (!att.schedule) {
        attObj.paymentStatus = 'unpaid';
        return attObj;
      }
      const payment = paymentByScheduleId.get(att.schedule._id.toString());
      if (!payment) {
        attObj.paymentStatus = 'unpaid';
      } else if (payment.status === 'confirmed') {
        attObj.paymentStatus = 'paid';
      } else if (payment.status === 'pending') {
        attObj.paymentStatus = 'pending';
      } else {
        attObj.paymentStatus = 'unpaid';
      }
      return attObj;
    });

    sendResponse(res, 200, true, result, 'My attendance history');
  } catch (error) {
    console.error('Get my attendance error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /teacher-history — ประวัติการสอนของครู (history)
// ────────────────────────────────────────────────────────────────────────────
router.get('/teacher-history', authenticateToken, async (req, res) => {
  try {
    const isTeacher = req.user.role === 'teacher';
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);

    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    // teacher: ดูของตัวเอง | manager: filter ด้วย teacherId + month ได้
    const { teacherId, month } = req.query; // month = "YYYY-MM"
    let query = {};
    if (req.user.role === 'teacher') {
      query.teacher = req.user.id;
    } else if (isManagerOrAdmin && teacherId) {
      query.teacher = teacherId;
    }
    // filter เดือน
    if (month) {
      const [y, m] = month.split('-').map(Number);
      const startDate = new Date(y, m - 1, 1);
      const endDate   = new Date(y, m, 0, 23, 59, 59);
      query.date = { $gte: startDate, $lte: endDate };
    }

    const schedules = await Schedule.find({
      ...query,
      status: { $nin: ['cancelled'] }
    })
      .populate('course', 'name subject type description gradeLevel teachingType')
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('studentConfirmations.student', 'firstName lastName nickname')
      .populate('managerConfirmedBy', 'firstName lastName nickname')
      .sort({ date: -1 });

    // เพิ่มข้อมูล attendance count ในแต่ละ schedule
    const result = await Promise.all(schedules.map(async (s) => {
      const attendanceCount = await Attendance.countDocuments({ schedule: s._id });
      return { ...s.toObject(), attendanceCount };
    }));

    sendResponse(res, 200, true, result, 'Teacher history retrieved');
  } catch (error) {
    console.error('Get teacher history error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
