const express = require('express');
const router = express.Router();
const Schedule = require('../models/Schedule');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Payment = require('../models/Payment');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject, computeEffectivePrice, computeEffectiveTeacherIncome } = require('../utils/helpers');
const {
  buildPaymentSummariesByScheduleId,
  deriveDisplayStatus,
  SCHEDULE_COURSE_FIELDS,
  SCHEDULE_TEACHER_FIELDS,
  SCHEDULE_STUDENT_FIELDS
} = require('../utils/scheduleAggregation');
const { sendScheduleCreatedEmail, sendScheduleConfirmedEmail, sendPaymentReminderEmail, sendScheduleRescheduledEmail, sendStudentBookingConfirmedEmail, sendStudentBookingDeclinedEmail, sendVideoLinkEmail } = require('../services/emailService');
const { generateQRToken, generateQRCodeDataURL } = require('../services/qrService');
const { reverseCompletedScheduleHours } = require('../services/hoursService');

// ── Timezone helper — แปลง schedule.date + timeString "HH:mm" เป็น Date (Bangkok UTC+7) ──
function bangkokClassTime(scheduleDate, timeStr) {
  const d = new Date(scheduleDate);
  const dateStr = new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  return new Date(`${dateStr}T${timeStr}:00+07:00`);
}

// ────────────────────────────────────────────────────────────────────────────
// POST / — สร้าง Schedule ใหม่ (manager, รวมถึง manager ที่ใส่ตัวเองเป็น teacher)
// ────────────────────────────────────────────────────────────────────────────
router.post('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const {
      course, teacher, date, startTime, endTime,
      zoomLink, room, note,
      teacherIncomeGroup, teacherIncomeIndividual,
      coursePrice
    } = req.body;

    if (!course || !teacher || !date || !startTime || !endTime) {
      return sendResponse(res, 400, false, null, 'Missing required fields');
    }

    const courseExists = await Course.findById(course).populate('teacher', 'firstName lastName nickname email');
    if (!courseExists) {
      return sendResponse(res, 400, false, null, 'Course not found');
    }

    const teacherUser = await User.findById(teacher);
    if (!teacherUser) {
      return sendResponse(res, 400, false, null, 'Teacher not found');
    }

    const enrolledStudents = await Enrollment.find({ course, status: 'active' }).select('student').populate('student', 'firstName lastName nickname email');
    const studentIds = enrolledStudents.map(e => e.student._id);
    const studentUsers = enrolledStudents.map(e => e.student);

    // คำนวณ duration
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    let totalDurationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    if (totalDurationMinutes <= 0) totalDurationMinutes += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)

    // สร้าง studentConfirmations
    const studentConfirmations = studentIds.map(sid => ({
      student: sid,
      status: 'pending',
      confirmedAt: null
    }));

    // ถ้า manager ไม่ได้ระบุค่า income → ดึงจาก Course อัตโนมัติ
    const finalIncomeGroup      = (teacherIncomeGroup      != null && teacherIncomeGroup      !== 0) ? teacherIncomeGroup      : (courseExists.teacherIncomeGroup      || 0);
    const finalIncomeIndividual = (teacherIncomeIndividual != null && teacherIncomeIndividual !== 0) ? teacherIncomeIndividual : (courseExists.teacherIncomeIndividual || 0);
    const finalCoursePrice      = (coursePrice             != null && coursePrice             !== 0) ? coursePrice             : (courseExists.coursePrice             || 0);

    const schedule = new Schedule({
      course,
      teacher,
      students: studentIds,
      date: new Date(date),
      startTime,
      endTime,
      zoomLink: zoomLink || null,
      room: room || null,
      note: note || null,
      status: 'pending',
      teacherIncomeGroup:      finalIncomeGroup,
      teacherIncomeIndividual: finalIncomeIndividual,
      coursePrice:             finalCoursePrice,
      // สืบทอด incomeHourly จาก Course (ถ้าเป็นโค้ดใหม่ → true)
      incomeHourly:            !!courseExists.incomeHourly,
      totalDurationMinutes,
      studentConfirmations
    });

    await schedule.save();
    await schedule.populate('course', 'name subject');
    await schedule.populate('teacher', 'firstName lastName nickname email');
    await schedule.populate('students', 'firstName lastName nickname email grade academicYear');

    // แจ้งเตือนในระบบ — ครูผู้สอน
    const teacherNotif = new Notification({
      recipient: teacher,
      sender: req.user.id,
      type: 'schedule',
      title: 'นัดสอนใหม่รอยืนยัน',
      message: `มีนัดสอน ${courseExists.name} วันที่ ${new Date(date).toLocaleDateString('th-TH')} เวลา ${startTime} — กรุณายืนยัน`,
      relatedId: schedule._id
    });
    await teacherNotif.save();

    // แจ้งเตือนในระบบ — นักเรียนทุกคน
    for (const studentId of studentIds) {
      const notification = new Notification({
        recipient: studentId,
        sender: req.user.id,
        type: 'schedule',
        title: 'นัดสอนใหม่รอยืนยัน',
        message: `มีนัดสอน ${courseExists.name} วันที่ ${new Date(date).toLocaleDateString('th-TH')} เวลา ${startTime} — กรุณายืนยัน`,
        relatedId: schedule._id
      });
      await notification.save();
    }

    // ส่งอีเมลแจ้งนักเรียน
    try {
      const recipients = studentUsers.map(s => ({ email: s.email, name: `${s.firstName} ${s.lastName}` }));
      await sendScheduleCreatedEmail({
        recipients,
        teacherName: `${teacherUser.firstName} ${teacherUser.lastName}`,
        courseName: courseExists.name,
        subject: courseExists.subject,
        members: studentUsers.map(s => `${s.firstName} ${s.lastName}`),
        date,
        startTime,
        endTime,
        totalDurationMinutes: schedule.totalDurationMinutes,
        coursePrice: schedule.coursePrice
      });
    } catch (emailErr) {
      console.error('[Schedule] ส่งอีเมลล้มเหลว:', emailErr.message);
    }

    sendResponse(res, 201, true, schedule, 'Schedule created');
  } catch (error) {
    console.error('Create schedule error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET / — ดึง Schedule ทั้งหมด
// ────────────────────────────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { course, teacher, status, startDate, endDate } = req.query;

    let query = {};

    if (req.user.role === 'teacher') {
      query.teacher = req.user.id;
    } else if (req.user.role === 'student') {
      query.students = { $in: [req.user.id] };
    }

    if (course) query.course = course;
    // Teachers can only see their own schedules — ignore ?teacher= param override
    if (teacher && !['teacher', 'student'].includes(req.user.role)) query.teacher = teacher;
    if (status) query.status = status;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const total = await Schedule.countDocuments(query);
    const schedules = await Schedule.find(query)
      .populate('course', 'name subject')
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('studentConfirmations.student', 'firstName lastName nickname')
      .limit(limit)
      .skip(skip)
      .sort({ date: 1 });

    sendResponse(res, 200, true, schedules, 'Schedules retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get schedules error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Static routes MUST be before /:id
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// buildRoleQuery — สร้าง query filter ตาม role และ filter params
//   - teacher: ดูได้เฉพาะของตัวเอง
//   - student: ดูได้เฉพาะของตัวเอง
//   - admin/manager: ดูทั้งหมด หรือ filter ด้วย teacherId / studentId
// ────────────────────────────────────────────────────────────────────────────
function buildRoleQuery(user, queryParams = {}) {
  const { teacherId, studentId } = queryParams;
  const isManagerOrAdmin = ['manager', 'admin'].includes(user.role);

  if (user.role === 'teacher') {
    // Teacher: เห็นเฉพาะตารางสอนของตัวเอง — ไม่สามารถ override ได้
    return { teacher: user.id };
  }

  if (user.role === 'student') {
    // Student: เห็นเฉพาะตารางเรียนของตัวเอง — ไม่สามารถ override ได้
    return { students: { $in: [user.id] } };
  }

  if (isManagerOrAdmin) {
    if (teacherId) {
      // Manager/Admin ดูตารางสอนของครูคนที่เลือก
      return { teacher: teacherId };
    }
    if (studentId) {
      // Manager/Admin ดูตารางเรียนของนักเรียนคนที่เลือก
      return { students: { $in: [studentId] } };
    }
    // ดูทั้งหมด
    return {};
  }

  return {};
}

// Calendar handler — รายเดือน (shared path)
const calendarMonthlyHandler = async (req, res) => {
  try {
    const { year, month, teacherId, studentId } = req.query;

    if (!year || !month) {
      return sendResponse(res, 400, false, null, 'Year and month required');
    }

    const startDate = new Date(year, parseInt(month) - 1, 1);
    const endDate = new Date(year, parseInt(month), 0);

    const roleFilter = buildRoleQuery(req.user, { teacherId, studentId });
    const query = { date: { $gte: startDate, $lte: endDate }, status: { $ne: 'cancelled' }, ...roleFilter };

    const schedules = await Schedule.find(query)
      .populate('course', SCHEDULE_COURSE_FIELDS)
      .populate('teacher', SCHEDULE_TEACHER_FIELDS)
      .populate('students', SCHEDULE_STUDENT_FIELDS)
      .populate('studentConfirmations.student', 'firstName lastName nickname')
      .populate('managerConfirmedBy', 'firstName lastName nickname')
      .sort({ date: 1 });

    // Attach paymentSummary per schedule (batched — no N+1)
    const summaries = await buildPaymentSummariesByScheduleId(schedules);

    // จัดกลุ่มตามวัน + แนบ paymentSummary
    const calendarData = {};
    schedules.forEach(schedule => {
      const dateKey = schedule.date.toISOString().split('T')[0];
      if (!calendarData[dateKey]) calendarData[dateKey] = [];
      const obj = schedule.toObject();
      obj.paymentSummary = summaries.get(schedule._id.toString()) || null;
      obj.displayStatus  = deriveDisplayStatus(schedule);
      calendarData[dateKey].push(obj);
    });

    sendResponse(res, 200, true, calendarData, 'Monthly calendar data retrieved');
  } catch (error) {
    console.error('Get monthly calendar error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
};

// Calendar handler — รายสัปดาห์
const calendarWeeklyHandler = async (req, res) => {
  try {
    const { startDate, endDate, teacherId, studentId } = req.query;

    if (!startDate || !endDate) {
      return sendResponse(res, 400, false, null, 'startDate and endDate required');
    }

    const roleFilter = buildRoleQuery(req.user, { teacherId, studentId });
    const query = {
      date: { $gte: new Date(startDate), $lte: new Date(endDate) },
      status: { $ne: 'cancelled' },
      ...roleFilter
    };

    const schedules = await Schedule.find(query)
      .populate('course', SCHEDULE_COURSE_FIELDS)
      .populate('teacher', SCHEDULE_TEACHER_FIELDS)
      .populate('students', SCHEDULE_STUDENT_FIELDS)
      .populate('studentConfirmations.student', 'firstName lastName nickname')
      .populate('managerConfirmedBy', 'firstName lastName nickname')
      .sort({ date: 1, startTime: 1 });

    // Attach paymentSummary per schedule (batched — no N+1)
    const summaries = await buildPaymentSummariesByScheduleId(schedules);

    // จัดกลุ่มตามวัน + แนบ paymentSummary
    const calendarData = {};
    schedules.forEach(schedule => {
      const dateKey = schedule.date.toISOString().split('T')[0];
      if (!calendarData[dateKey]) calendarData[dateKey] = [];
      const obj = schedule.toObject();
      obj.paymentSummary = summaries.get(schedule._id.toString()) || null;
      obj.displayStatus  = deriveDisplayStatus(schedule);
      calendarData[dateKey].push(obj);
    });

    sendResponse(res, 200, true, calendarData, 'Weekly calendar data retrieved');
  } catch (error) {
    console.error('Get weekly calendar error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
};

router.get('/calendar/view', authenticateToken, calendarMonthlyHandler);
router.get('/calendar', authenticateToken, calendarMonthlyHandler);
router.get('/calendar/weekly', authenticateToken, calendarWeeklyHandler);

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/confirm-teacher — ครู/Manager ยืนยันรับการสอน
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/confirm-teacher', authenticateToken, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name subject')
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    const isTeacher = schedule.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);

    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    // กันยืนยันทับคลาสที่จบ/ยกเลิก/นักเรียนขาดแล้ว (ป้องกันย้อนกลับ flow)
    if (['completed', 'cancelled', 'absent'].includes(schedule.status)) {
      return sendResponse(res, 400, false, null, `ไม่สามารถยืนยันรับการสอนได้: คลาสอยู่ในสถานะ "${schedule.status}"`);
    }

    schedule.teacherConfirmed = true;
    schedule.teacherConfirmedAt = new Date();

    // ── Q1: ครูยืนยัน → status = 'confirmed' ทันที (ไม่รอนักเรียน) ──
    if (schedule.status === 'pending') {
      schedule.status = 'confirmed';
    }

    await schedule.save();

    // ── Q2: อัปเดต Enrollment ของคลาสนี้ pending → active ──
    try {
      const courseIdForEnroll = schedule.course?._id || schedule.course;
      if (courseIdForEnroll) {
        await Enrollment.updateMany(
          { course: courseIdForEnroll, status: 'pending' },
          { $set: { status: 'active' } }
        );
      }
    } catch (enrollErr) {
      console.warn('Failed to update Enrollment status:', enrollErr?.message);
    }

    // ── Q3: Propagate to Course (per-schedule confirmation) ──
    // ครูต้องยืนยันแต่ละ schedule ที่รับผิดชอบ — Course.teacherAccepted = true
    // เฉพาะเมื่อทุก schedule (ไม่รวม cancelled) ยืนยันแล้ว
    try {
      const Course = require('../models/Course');
      const courseId = schedule.course?._id || schedule.course;
      if (courseId) {
        const remaining = await Schedule.countDocuments({
          course: courseId,
          teacherConfirmed: false,
          status: { $ne: 'cancelled' }
        });
        if (remaining === 0) {
          // ครูยืนยันครบทุก schedule แล้ว → ยกระดับ Course
          const course = await Course.findById(courseId);
          if (course && !course.teacherAccepted) {
            course.teacherAccepted = true;
            if (course.status === 'pending') course.status = 'approved';
            await course.save();
          }
        }
      }
    } catch (propagateErr) {
      console.warn('Failed to propagate teacher confirm to Course:', propagateErr?.message);
    }

    // แจ้งนักเรียนว่าครูยืนยันแล้ว
    for (const student of schedule.students) {
      const notif = new Notification({
        recipient: student._id,
        sender: req.user.id,
        type: 'schedule',
        title: 'ครูยืนยันนัดสอนแล้ว',
        message: `${schedule.teacher.firstName} ยืนยันการสอน ${schedule.course.name} แล้ว — กรุณายืนยันจากฝั่งคุณ`,
        relatedId: schedule._id
      });
      await notif.save();
    }

    await schedule.populate('studentConfirmations.student', 'firstName lastName nickname');
    sendResponse(res, 200, true, schedule, 'Teacher confirmed');
  } catch (error) {
    console.error('Teacher confirm error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/confirm-student — นักเรียนยืนยัน/ปฏิเสธนัดสอน
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/confirm-student', authenticateToken, roleCheck(['student']), async (req, res) => {
  try {
    const { action } = req.body; // 'accepted' | 'declined'

    if (!['accepted', 'declined'].includes(action)) {
      return sendResponse(res, 400, false, null, 'action must be accepted or declined');
    }

    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name subject')
      .populate('teacher', 'firstName lastName nickname email');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    // ตรวจสอบว่านักเรียนอยู่ใน students[] หรือไม่
    const isInStudents = schedule.students.some(
      sid => sid.toString() === req.user.id
    );
    if (!isInStudents) {
      return sendResponse(res, 403, false, null, 'You are not in this schedule');
    }

    // ถ้าอยู่ใน students แต่ยังไม่มีใน studentConfirmations (เช่น ลงทะเบียนหลังสร้าง schedule)
    // → auto-add entry ให้
    const existingConf = schedule.studentConfirmations.find(
      sc => sc.student.toString() === req.user.id
    );

    // ── M1: ป้องกันการตอบซ้ำ — ถ้าตอบแล้ว (ไม่ใช่ pending) ไม่ให้เปลี่ยนใจ ──
    if (existingConf && existingConf.status !== 'pending') {
      return sendResponse(res, 400, false, null,
        `คุณได้${existingConf.status === 'accepted' ? 'ยืนยัน' : 'ปฏิเสธ'}นัดสอนนี้ไปแล้ว ไม่สามารถเปลี่ยนคำตอบได้`);
    }

    // ── C3: ใช้ atomic update เพื่อกัน race condition ──
    // ถ้ายังไม่มี entry → $addToSet (atomic, จะไม่ push ซ้ำ)
    // ถ้ามีแล้ว (pending) → update ด้วย arrayFilters (atomic)
    if (!existingConf) {
      // เพิ่ม entry แบบ atomic ถ้ายังไม่มีใน array
      await Schedule.updateOne(
        { _id: schedule._id, 'studentConfirmations.student': { $ne: req.user.id } },
        { $push: { studentConfirmations: { student: req.user.id, status: action, confirmedAt: new Date() } } }
      );
    } else {
      // update entry ที่มีอยู่แบบ atomic
      await Schedule.updateOne(
        { _id: schedule._id, 'studentConfirmations.student': req.user.id },
        { $set: {
            'studentConfirmations.$.status': action,
            'studentConfirmations.$.confirmedAt': new Date()
          } }
      );
    }

    // ── recompute isFullyConfirmed หลัง atomic update ──
    // (atomic updateOne bypass pre-save hook — ต้อง recalc ด้วยตัวเอง)
    const refreshed = await Schedule.findById(schedule._id);
    if (refreshed) {
      const allAccepted = refreshed.studentConfirmations.length > 0 &&
        refreshed.studentConfirmations.every(sc => sc.status === 'accepted');
      const newFullyConfirmed = !!(refreshed.teacherConfirmed && allAccepted);
      if (refreshed.isFullyConfirmed !== newFullyConfirmed) {
        await Schedule.updateOne(
          { _id: refreshed._id },
          { $set: { isFullyConfirmed: newFullyConfirmed, updatedAt: new Date() } }
        );
      }
    }

    // reload schedule หลัง atomic update เพื่อให้ได้ confirmations ล่าสุด
    const updatedSchedule = await Schedule.findById(schedule._id)
      .populate('course', 'name subject')
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('studentConfirmations.student', 'firstName lastName nickname');

    // แจ้งครูว่านักเรียนตอบกลับ
    const student = await User.findById(req.user.id);
    const notif = new Notification({
      recipient: updatedSchedule.teacher._id,
      sender: req.user.id,
      type: 'schedule',
      title: action === 'accepted' ? 'นักเรียนยืนยันนัดสอน' : 'นักเรียนปฏิเสธนัดสอน',
      message: `${student.firstName} ${student.lastName} ${action === 'accepted' ? 'ยืนยัน' : 'ปฏิเสธ'}นัดสอน ${updatedSchedule.course.name}`,
      relatedId: updatedSchedule._id
    });
    await notif.save();

    // ส่งอีเมลแจ้งครูเมื่อนักเรียนยืนยัน หรือ ปฏิเสธ
    if (updatedSchedule.teacher?.email) {
      try {
        const emailParams = {
          teacherEmail: updatedSchedule.teacher.email,
          teacherName: `${updatedSchedule.teacher.firstName} ${updatedSchedule.teacher.lastName}`,
          studentName: `${student.firstName} ${student.lastName}`,
          courseName: updatedSchedule.course.name || updatedSchedule.course.subject || 'คอร์สเรียน',
          date: updatedSchedule.date,
          startTime: updatedSchedule.startTime,
          endTime: updatedSchedule.endTime
        };
        if (action === 'accepted') {
          await sendStudentBookingConfirmedEmail(emailParams);
        } else if (action === 'declined') {
          await sendStudentBookingDeclinedEmail(emailParams);
        }
      } catch (emailErr) {
        console.error('[student-confirm] ส่งอีเมลล้มเหลว:', emailErr.message);
      }
    }

    sendResponse(res, 200, true, updatedSchedule, `Student ${action}`);
  } catch (error) {
    console.error('Student confirm error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/generate-qr — ครู/Manager สร้าง QR Code สำหรับเช็คชื่อ
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/generate-qr', authenticateToken, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name')
      .populate('teacher', 'firstName lastName nickname');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    const isTeacher = schedule.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);

    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'Only teacher or manager can generate QR');
    }

    // ── ตรวจ status: เปิด QR ได้เฉพาะคลาสที่ยังไม่จบ ──
    if (schedule.status === 'completed') {
      return sendResponse(res, 400, false, null, 'คลาสนี้เสร็จสิ้นแล้ว ไม่สามารถเปิด QR ได้');
    }
    if (schedule.status === 'cancelled') {
      return sendResponse(res, 400, false, null, 'คลาสนี้ถูกยกเลิกแล้ว ไม่สามารถเปิด QR ได้');
    }
    if (schedule.status === 'awaiting_confirmation') {
      return sendResponse(res, 400, false, null, 'คลาสนี้รอ Manager ยืนยัน ไม่สามารถเปิด QR ใหม่ได้');
    }
    // ── ครูต้องยืนยันรับสอนก่อนเปิด QR ──
    if (!schedule.teacherConfirmed) {
      return sendResponse(res, 400, false, null, 'กรุณายืนยันรับสอนคลาสนี้ก่อนเปิด QR');
    }

    // ── ตรวจสอบหน้าต่างเวลา (Bangkok UTC+7): เปิด QR ได้เฉพาะในช่วงเวลาคลาส + 30 นาที ──
    const now = new Date();
    const classStart  = bangkokClassTime(schedule.date, schedule.startTime);
    let   classEnd    = bangkokClassTime(schedule.date, schedule.endTime);
    // คลาสข้ามเที่ยงคืน (เช่น 23:00–00:00) → endTime ตกไปวันถัดไป
    if (classEnd <= classStart) {
      classEnd = new Date(classEnd.getTime() + 24 * 60 * 60 * 1000);
    }
    const scanDeadline = new Date(classEnd.getTime() + 30 * 60 * 1000);

    if (now < classStart) {
      return sendResponse(res, 400, false, null,
        `ยังไม่ถึงเวลาเรียน เปิด QR ได้ตั้งแต่ ${schedule.startTime} น.`);
    }
    if (now > scanDeadline) {
      return sendResponse(res, 400, false, null,
        `หมดเวลาเปิด QR แล้ว (เปิดได้ถึง ${schedule.endTime} น. + 30 นาที)`);
    }

    // สร้าง token ใหม่ + กำหนด expire ตรงกับสิ้นสุดหน้าต่างเวลา (endTime + 30 นาที)
    const qrToken = generateQRToken(schedule._id.toString());
    const qrExpiresAt = scanDeadline;

    schedule.qrToken = qrToken;
    schedule.qrGeneratedAt = new Date();
    schedule.qrExpiresAt = qrExpiresAt;
    schedule.qrActive = true;
    await schedule.save();

    // สร้าง QR Data URL (base64 image) เพื่อแสดงบนหน้าจอ
    // QR encode เป็น URL ที่นักเรียนสแกนแล้วเปิดเว็บไซต์เพื่อเช็คชื่อได้เลย
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const qrPayload = `${frontendUrl}/scan?scheduleId=${schedule._id}&token=${encodeURIComponent(qrToken)}`;
    const qrDataURL = await generateQRCodeDataURL(qrPayload);

    sendResponse(res, 200, true, {
      qrDataURL,
      qrToken,
      qrExpiresAt,
      scheduleId: schedule._id
    }, 'QR generated');
  } catch (error) {
    console.error('Generate QR error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/close-qr — ครู/Manager ปิด QR
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/close-qr', authenticateToken, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id).populate('teacher', 'firstName lastName nickname');
    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    const isTeacher = schedule.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);
    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    // ── ตรวจ status: ปิดได้เฉพาะคลาสที่กำลังจะสอน (ไม่ใช่ completed/cancelled/awaiting) ──
    const allowedStatuses = ['pending', 'confirmed', 'scheduled'];
    if (!allowedStatuses.includes(schedule.status)) {
      return sendResponse(res, 400, false, null,
        `ไม่สามารถยืนยันเสร็จสิ้นได้: คลาสนี้มีสถานะ "${schedule.status}" แล้ว`);
    }

    // ── ต้องมีนักเรียนเช็คชื่ออย่างน้อย 1 คน — ยกเว้น admin (ปิดได้แม้ยังไม่มีคนเช็คชื่อ) ──
    const attendanceCount = await Attendance.countDocuments({ schedule: schedule._id });
    const isAdmin = req.user.role === 'admin';
    if (attendanceCount === 0 && !isAdmin) {
      return sendResponse(res, 400, false, null,
        'ยังไม่มีนักเรียนเช็คชื่อ — กรุณารอนักเรียนสแกน QR ก่อนยืนยันเสร็จสิ้นการสอน');
    }

    schedule.qrActive = false;

    // คำนวณรายได้จริงตามจำนวนผู้เช็คชื่อ
    // ใช้ "วันที่" ของคลาสเป็นตัวตัด (TEACHER_HOURLY_FROM = 8 พ.ค. 2569)
    // ตั้งแต่วันนั้นไป → rate × duration; ก่อนหน้านั้น → flat rate
    if (attendanceCount === 0) {
      schedule.actualTeacherIncome = 0;
    } else {
      schedule.actualTeacherIncome = computeEffectiveTeacherIncome(schedule, attendanceCount);
    }

    // เปลี่ยนสถานะเป็น awaiting_confirmation เพื่อรอผู้จัดการยืนยัน
    // (hours จะถูกอัปเดตใน manager-confirm เพื่อป้องกัน double-counting)
    schedule.status = 'awaiting_confirmation';
    await schedule.save();

    sendResponse(res, 200, true, { actualTeacherIncome: schedule.actualTeacherIncome, attendanceCount }, 'QR closed, awaiting manager confirmation');
  } catch (error) {
    console.error('Close QR error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id/qr-status — ดูสถานะ QR และรายชื่อที่เช็คแล้ว (teacher/manager)
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id/qr-status', authenticateToken, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id).populate('teacher', 'firstName lastName nickname');
    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    const isTeacher = schedule.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);
    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    const attendances = await Attendance.find({ schedule: schedule._id })
      .populate('student', 'firstName lastName nickname profileImage')
      .sort({ scannedAt: 1 });

    sendResponse(res, 200, true, {
      qrActive: schedule.qrActive,
      qrExpiresAt: schedule.qrExpiresAt,
      attendances,
      count: attendances.length
    }, 'QR status retrieved');
  } catch (error) {
    console.error('QR status error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /:id/reschedule — ย้ายเวลานัดสอน (manager/admin only)
// Body: { date: 'YYYY-MM-DD', startTime: 'HH:mm', endTime: 'HH:mm' }
// ────────────────────────────────────────────────────────────────────────────
router.patch('/:id/reschedule', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { date, startTime, endTime } = req.body;
    if (!date || !startTime || !endTime) {
      return sendResponse(res, 400, false, null, 'Missing required fields: date, startTime, endTime');
    }

    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name subject')
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear');
    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    // บันทึกค่าเดิมก่อนแก้ไข
    const oldDate      = schedule.date;
    const oldStartTime = schedule.startTime;
    const oldEndTime   = schedule.endTime;

    // คำนวณ duration ใหม่
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let totalDurationMinutes = (eh * 60 + em) - (sh * 60 + sm);
    if (totalDurationMinutes <= 0) totalDurationMinutes += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)

    schedule.date = new Date(date);
    schedule.startTime = startTime;
    schedule.endTime = endTime;
    schedule.totalDurationMinutes = totalDurationMinutes;

    await schedule.save();
    await schedule.populate('studentConfirmations.student', 'firstName lastName nickname');

    // ── Sync Schedule → Course เพื่อให้หน้าจัดการรายวิชาแสดงข้อมูลตรงกับ Calendar ──
    // (ก่อนหน้านี้แก้แค่ Schedule ทำให้ Course.scheduledDate/startTime/endTime ค้างของเก่า)
    if (schedule.course?._id) {
      try {
        await Course.findByIdAndUpdate(schedule.course._id, {
          scheduledDate: schedule.date,
          startTime: schedule.startTime,
          endTime: schedule.endTime
        });
      } catch (syncErr) {
        console.error('[Reschedule] Course sync failed (non-blocking):', syncErr.message);
      }
    }

    // ส่ง Notification ให้ครูและนักเรียน
    const courseObj   = schedule.course;
    const teacherObj  = schedule.teacher;
    const studentObjs = schedule.students;
    const newDateFmt  = new Date(date).toLocaleDateString('th-TH', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });

    if (teacherObj && teacherObj._id) {
      await new Notification({
        recipient: teacherObj._id,
        sender:    req.user.id,
        type:      'schedule',
        title:     '🕐 เปลี่ยนเวลานัดสอน',
        message:   `วิชา: ${courseObj?.name || ''} | เวลาใหม่: ${newDateFmt} ${startTime}–${endTime}`,
        relatedId: schedule._id
      }).save();
    }
    for (const student of studentObjs) {
      await new Notification({
        recipient: student._id,
        sender:    req.user.id,
        type:      'schedule',
        title:     '🕐 เปลี่ยนเวลานัดสอน',
        message:   `วิชา: ${courseObj?.name || ''} | เวลาใหม่: ${newDateFmt} ${startTime}–${endTime}`,
        relatedId: schedule._id
      }).save();
    }

    // ส่งอีเมลแจ้งเตือนการย้ายเวลา
    const teacherName = teacherObj ? `${teacherObj.firstName} ${teacherObj.lastName}` : '-';
    sendScheduleRescheduledEmail({
      teacherRecipient:  teacherObj ? { email: teacherObj.email } : null,
      studentRecipients: studentObjs.map(s => ({ email: s.email })),
      courseName:        courseObj?.name || 'นัดสอน',
      teacherName,
      oldDate,
      oldStartTime,
      oldEndTime,
      newDate:      new Date(date),
      newStartTime: startTime,
      newEndTime:   endTime
    }).catch(e => console.error('[Email] Reschedule email error:', e));

    sendResponse(res, 200, true, schedule, 'Schedule rescheduled');
  } catch (error) {
    console.error('Reschedule error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /:id/teacher-reschedule — ครูเลื่อนคลาสของตัวเอง (เฉพาะวัน/เวลา)
// Body: { date: 'YYYY-MM-DD', startTime: 'HH:mm', endTime: 'HH:mm' }
// ────────────────────────────────────────────────────────────────────────────
router.patch('/:id/teacher-reschedule', authenticateToken, roleCheck(['teacher', 'manager', 'admin']), async (req, res) => {
  try {
    const { date, startTime, endTime } = req.body;
    if (!date || !startTime || !endTime) {
      return sendResponse(res, 400, false, null, 'Missing required fields: date, startTime, endTime');
    }

    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name subject createdBy')
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear');
    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    // เฉพาะครูเจ้าของคลาส (manager/admin ใช้ /reschedule ปกติ)
    if (req.user.role === 'teacher' && schedule.teacher?._id.toString() !== req.user.id) {
      return sendResponse(res, 403, false, null, 'ไม่มีสิทธิ์เลื่อนคลาสนี้ (ครูเลื่อนได้เฉพาะคลาสของตัวเอง)');
    }

    // คลาสที่จบ/ยกเลิก/รอ manager แล้ว ไม่ให้เลื่อน
    if (['completed', 'cancelled', 'awaiting_confirmation'].includes(schedule.status)) {
      return sendResponse(res, 400, false, null, `ไม่สามารถเลื่อนคลาสนี้ได้: สถานะปัจจุบันคือ "${schedule.status}"`);
    }

    const oldDate      = schedule.date;
    const oldStartTime = schedule.startTime;
    const oldEndTime   = schedule.endTime;

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let totalDurationMinutes = (eh * 60 + em) - (sh * 60 + sm);
    if (totalDurationMinutes <= 0) totalDurationMinutes += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)

    schedule.date              = new Date(date);
    schedule.startTime         = startTime;
    schedule.endTime           = endTime;
    schedule.totalDurationMinutes = totalDurationMinutes;
    await schedule.save();
    await schedule.populate('studentConfirmations.student', 'firstName lastName nickname');

    // Sync Course (เฉพาะ date/time)
    if (schedule.course?._id) {
      try {
        await Course.findByIdAndUpdate(schedule.course._id, {
          scheduledDate: schedule.date,
          startTime:     schedule.startTime,
          endTime:       schedule.endTime
        });
      } catch (syncErr) {
        console.error('[TeacherReschedule] Course sync failed (non-blocking):', syncErr.message);
      }
    }

    const courseObj   = schedule.course;
    const teacherObj  = schedule.teacher;
    const studentObjs = schedule.students || [];
    const teacherName = teacherObj ? (teacherObj.nickname || `${teacherObj.firstName} ${teacherObj.lastName}`) : 'ครู';
    const subjectName = courseObj?.subject || courseObj?.name || 'นัดสอน';
    const newDateFmt  = new Date(date).toLocaleDateString('th-TH', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
    const msg = `วิชา: ${subjectName} | ครู ${teacherName} เลื่อนเป็น ${newDateFmt} ${startTime}–${endTime}`;

    // แจ้ง manager ที่สร้างคลาส (Course.createdBy)
    const managerId = courseObj?.createdBy;
    if (managerId) {
      await new Notification({
        recipient: managerId,
        sender:    req.user.id,
        type:      'schedule',
        title:     '🕐 ครูเลื่อนเวลานัดสอน',
        message:   msg,
        relatedId: schedule._id
      }).save();
    }

    // แจ้งนักเรียนทุกคน
    for (const student of studentObjs) {
      await new Notification({
        recipient: student._id,
        sender:    req.user.id,
        type:      'schedule',
        title:     '🕐 ครูเลื่อนเวลานัดสอน',
        message:   msg,
        relatedId: schedule._id
      }).save();
    }

    // อีเมล: ส่งนักเรียน + manager (ไม่ส่งครูเอง — ครูเป็นคนเลื่อน)
    let managerEmail = null;
    if (managerId) {
      try {
        const managerUser = await User.findById(managerId).select('email');
        managerEmail = managerUser?.email || null;
      } catch (_) { /* ignore */ }
    }
    sendScheduleRescheduledEmail({
      teacherRecipient:  managerEmail ? { email: managerEmail } : null,
      studentRecipients: studentObjs.map(s => ({ email: s.email })),
      courseName:        subjectName,
      teacherName:       teacherObj ? `${teacherObj.firstName} ${teacherObj.lastName}` : '-',
      oldDate,
      oldStartTime,
      oldEndTime,
      newDate:      new Date(date),
      newStartTime: startTime,
      newEndTime:   endTime
    }).catch(e => console.error('[Email] TeacherReschedule email error:', e));

    sendResponse(res, 200, true, schedule, 'Schedule rescheduled by teacher');
  } catch (error) {
    console.error('Teacher reschedule error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id — ดึง Schedule โดย ID
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name subject teacher')
      .populate('teacher', 'firstName lastName nickname email phone')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('studentConfirmations.student', 'firstName lastName nickname');

    if (!schedule) {
      return sendResponse(res, 404, false, null, 'Schedule not found');
    }

    if (req.user.role === 'student' &&
        !schedule.students.some(s => s._id.toString() === req.user.id)) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    if (req.user.role === 'teacher' && schedule.teacher._id.toString() !== req.user.id) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    sendResponse(res, 200, true, schedule, 'Schedule retrieved');
  } catch (error) {
    console.error('Get schedule error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /:id — อัพเดต Schedule
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const {
      date, startTime, endTime, zoomLink, room, status, note,
      teacherIncomeGroup, teacherIncomeIndividual, coursePrice
    } = req.body;

    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) {
      return sendResponse(res, 404, false, null, 'Schedule not found');
    }

    if (date) schedule.date = new Date(date);
    if (startTime) schedule.startTime = startTime;
    if (endTime) schedule.endTime = endTime;
    if (zoomLink !== undefined) schedule.zoomLink = zoomLink;
    if (room !== undefined) schedule.room = room;
    if (status && ['pending', 'confirmed', 'scheduled', 'completed', 'cancelled'].includes(status)) schedule.status = status;
    if (note !== undefined) schedule.note = note;
    if (teacherIncomeGroup !== undefined) schedule.teacherIncomeGroup = teacherIncomeGroup;
    if (teacherIncomeIndividual !== undefined) schedule.teacherIncomeIndividual = teacherIncomeIndividual;
    if (coursePrice !== undefined) schedule.coursePrice = coursePrice;

    await schedule.save();
    await schedule.populate('course', 'name');
    await schedule.populate('teacher', 'firstName lastName nickname email');

    // ── Sync Schedule → Course ให้ฟิลด์ที่ทับซ้อนตรงกัน ──
    if (schedule.course?._id && (date || startTime || endTime || coursePrice !== undefined ||
        teacherIncomeGroup !== undefined || teacherIncomeIndividual !== undefined)) {
      try {
        const courseSync = {};
        if (date)      courseSync.scheduledDate = schedule.date;
        if (startTime) courseSync.startTime     = schedule.startTime;
        if (endTime)   courseSync.endTime       = schedule.endTime;
        if (coursePrice             !== undefined) courseSync.coursePrice             = schedule.coursePrice;
        if (teacherIncomeGroup      !== undefined) courseSync.teacherIncomeGroup      = schedule.teacherIncomeGroup;
        if (teacherIncomeIndividual !== undefined) courseSync.teacherIncomeIndividual = schedule.teacherIncomeIndividual;
        await Course.findByIdAndUpdate(schedule.course._id, courseSync);
      } catch (syncErr) {
        console.error('[UpdateSchedule] Course sync failed (non-blocking):', syncErr.message);
      }
    }

    if (date || startTime) {
      for (const studentId of schedule.students) {
        const notification = new Notification({
          recipient: studentId,
          sender: req.user.id,
          type: 'schedule',
          title: 'อัปเดตนัดสอน',
          message: `นัดสอน ${schedule.course?.name || ''} มีการเปลี่ยนแปลงเวลา`,
          relatedId: schedule._id
        });
        await notification.save();
      }
    }

    sendResponse(res, 200, true, schedule, 'Schedule updated');
  } catch (error) {
    console.error('Update schedule error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /:id — ยกเลิก Schedule
// ────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);

    if (!schedule) {
      return sendResponse(res, 404, false, null, 'Schedule not found');
    }

    // ย้อนชั่วโมงสะสมถ้าคลาสนี้ completed แล้ว ก่อนเปลี่ยนเป็น cancelled
    await reverseCompletedScheduleHours(schedule);

    schedule.status = 'cancelled';
    await schedule.save();

    sendResponse(res, 200, true, schedule, 'Schedule cancelled');
  } catch (error) {
    console.error('Delete schedule error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /:id/manager-confirm — Manager ยืนยันสำเร็จการสอน
// บันทึก hours + income จริง → เปลี่ยน status เป็น completed
// ────────────────────────────────────────────────────────────────────────────
router.patch('/:id/manager-confirm', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    // ✅ populate course เพื่อให้ดึง subject ได้
    const schedule = await Schedule.findById(req.params.id)
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('course', 'name subject');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    if (schedule.status !== 'awaiting_confirmation') {
      return sendResponse(res, 400, false, null, `ไม่สามารถยืนยันได้: สถานะปัจจุบันคือ "${schedule.status}"`);
    }

    const durationHours = (schedule.totalDurationMinutes || 0) / 60;

    // บันทึก teachingHours ของครู
    if (schedule.teacher && durationHours > 0) {
      await User.findByIdAndUpdate(schedule.teacher._id, { $inc: { teachingHours: durationHours } });
    }

    // บันทึก learningHours ของนักเรียนที่เช็คชื่อ
    const attendances = await Attendance.find({ schedule: schedule._id }).select('student');
    const attendedStudentIds = attendances.map(a => a.student.toString());
    for (const att of attendances) {
      if (durationHours > 0) {
        await User.findByIdAndUpdate(att.student, { $inc: { learningHours: durationHours } });
      }
    }

    // mark completed
    schedule.status = 'completed';
    schedule.managerConfirmedBy = req.user.id;
    schedule.managerConfirmedAt = new Date();
    await schedule.save();

    // ── Sync Course.status = 'completed' ให้ตรงกัน (ถ้ายังไม่ completed) ──
    if (schedule.course?._id) {
      try {
        await Course.findByIdAndUpdate(schedule.course._id, { status: 'completed' });
      } catch (syncErr) {
        console.error('[ManagerConfirm] Course status sync failed (non-blocking):', syncErr.message);
      }
    }

    const attendanceCount = attendances.length;
    // ✅ ดึง subject จาก course (Schedule schema ไม่มี field subject)
    const subjectName     = schedule.course?.subject || schedule.course?.name || '';
    const teacherIncome   = schedule.actualTeacherIncome || 0;
    const coursePrice     = computeEffectivePrice(schedule);
    const dateText        = new Date(schedule.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeText        = `${schedule.startTime} – ${schedule.endTime} น.`;

    // แจ้งครู
    if (schedule.teacher) {
      await Notification.create({
        recipient: schedule.teacher._id, type: 'general',
        title: '✅ ยืนยันสำเร็จการสอนแล้ว',
        message: `คลาส${subjectName ? ' ' + subjectName : ''} วันที่ ${dateText} ${timeText} — Manager ยืนยันแล้ว | รายได้: ฿${teacherIncome.toLocaleString('th-TH')} | ชม.สอน +${durationHours.toFixed(1)} ชม.`
      });
    }

    // แจ้งนักเรียนที่เช็คชื่อ
    for (const student of schedule.students) {
      if (!attendedStudentIds.includes(student._id.toString())) continue;
      await Notification.create({
        recipient: student._id, type: 'general',
        title: '✅ บันทึกการเรียนสำเร็จ',
        message: `คลาส${subjectName ? ' ' + subjectName : ''} วันที่ ${dateText} ${timeText} — บันทึกแล้ว | ชม.เรียน +${durationHours.toFixed(1)} ชม.${coursePrice > 0 ? ` | ค่าเรียน ฿${coursePrice.toLocaleString('th-TH')}` : ''}`
      });
    }

    sendResponse(res, 200, true, {
      scheduleId: schedule._id,
      attendanceCount,
      teacherIncome,
      durationHours
    }, 'ยืนยันสำเร็จการสอนเรียบร้อยแล้ว');
  } catch (error) {
    console.error('Manager confirm error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /:id/mark-absent — Manager/Admin ทำเครื่องหมาย "นักเรียนขาดเรียนโดยไม่แจ้ง"
// เฉพาะคลาสเดี่ยว 1:1 ที่นักเรียนไม่ได้เช็คชื่อ
//   → นักเรียนโดนค่าปรับ 100% ของราคาคลาส
//   → ครูได้ค่าตอบแทน 50% ของรายได้ครูปกติ (ไม่ได้ชั่วโมงสอน)
//   → status = 'absent'
// ────────────────────────────────────────────────────────────────────────────
router.patch('/:id/mark-absent', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id)
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email')
      .populate('course', 'name subject');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    // เฉพาะคลาสเดี่ยว 1:1
    if (!Array.isArray(schedule.students) || schedule.students.length !== 1) {
      return sendResponse(res, 400, false, null, 'ทำเครื่องหมายขาดได้เฉพาะคลาสเดี่ยว (นักเรียน 1 คน) เท่านั้น');
    }

    // ห้ามทำซ้ำหรือทำกับคลาสที่จบ/ยกเลิกแล้ว
    if (['completed', 'cancelled', 'absent'].includes(schedule.status)) {
      return sendResponse(res, 400, false, null, `ไม่สามารถทำเครื่องหมายขาดได้: สถานะปัจจุบันคือ "${schedule.status}"`);
    }

    const student = schedule.students[0];

    // นักเรียนต้องยังไม่เช็คชื่อ — ถ้าเช็คแล้วถือว่าเข้าเรียน คิดค่าปรับไม่ได้
    const scanned = await Attendance.findOne({ schedule: schedule._id, student: student._id });
    if (scanned) {
      return sendResponse(res, 400, false, null, 'นักเรียนเช็คชื่อแล้ว ไม่สามารถทำเครื่องหมายขาดได้');
    }

    // ── Time gate: manager ต้องรอหมดเวลาคลาสก่อน, admin กดได้เลยไม่ต้องรอ ──
    if (req.user.role !== 'admin') {
      const classStart = bangkokClassTime(schedule.date, schedule.startTime);
      let classEnd = bangkokClassTime(schedule.date, schedule.endTime);
      if (classEnd <= classStart) classEnd = new Date(classEnd.getTime() + 24 * 60 * 60 * 1000); // ข้ามเที่ยงคืน
      if (new Date() < classEnd) {
        return sendResponse(res, 400, false, null, 'ยังไม่หมดเวลาคลาส — ต้องรอจนคลาสจบก่อนจึงทำเครื่องหมายขาดได้');
      }
    }

    // ── คำนวณเงิน ──
    const penaltyAmount = computeEffectivePrice(schedule);                          // 100% ราคาคลาส (นักเรียนจ่าย)
    const normalTeacherIncome = computeEffectiveTeacherIncome(schedule, 1);         // รายได้ครูปกติ (individual)
    const teacherCompensation = Math.round(normalTeacherIncome * 0.5);             // 50% ให้ครู

    // ── บันทึก ──
    schedule.status = 'absent';
    schedule.actualTeacherIncome = teacherCompensation;   // ครูได้เงิน แต่ไม่บวก teachingHours
    schedule.absencePenalty = {
      student: student._id,
      penaltyAmount,
      teacherCompensation,
      markedBy: req.user.id,
      markedAt: new Date()
    };
    schedule.managerConfirmedBy = req.user.id;
    schedule.managerConfirmedAt = new Date();
    await schedule.save();

    // ไม่ sync Course.status — ให้ displayStatus ของ course อ่านจาก Schedule (absent) โดยตรง
    const subjectName = schedule.course?.subject || schedule.course?.name || '';
    const dateText    = new Date(schedule.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const timeText    = `${schedule.startTime} – ${schedule.endTime} น.`;

    // แจ้งครู
    if (schedule.teacher) {
      await Notification.create({
        recipient: schedule.teacher._id, type: 'general',
        title: '⚠️ นักเรียนขาดเรียน (ได้รับค่าตอบแทน 50%)',
        message: `คลาส${subjectName ? ' ' + subjectName : ''} วันที่ ${dateText} ${timeText} — นักเรียนขาดเรียนโดยไม่แจ้ง | ค่าตอบแทน: ฿${teacherCompensation.toLocaleString('th-TH')}`
      });
    }

    // แจ้งนักเรียน
    await Notification.create({
      recipient: student._id, type: 'general',
      title: '⚠️ ขาดเรียนโดยไม่แจ้งล่วงหน้า (มีค่าปรับ)',
      message: `คลาส${subjectName ? ' ' + subjectName : ''} วันที่ ${dateText} ${timeText} — บันทึกเป็นการขาดเรียนโดยไม่แจ้งล่วงหน้า | ค่าปรับ: ฿${penaltyAmount.toLocaleString('th-TH')} (ตามข้อ 3.4/3.6)`
    });

    sendResponse(res, 200, true, {
      scheduleId: schedule._id,
      penaltyAmount,
      teacherCompensation
    }, 'ทำเครื่องหมายนักเรียนขาดเรียนเรียบร้อยแล้ว');
  } catch (error) {
    console.error('Mark absent error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// POST /:id/send-video-link — Manager/Admin ส่งลิ้งค์ VDO ไปยังนักเรียนในคลาสกลุ่ม
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/send-video-link', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { videoLink } = req.body;
    if (!videoLink) return sendResponse(res, 400, false, null, 'videoLink is required');

    const schedule = await Schedule.findById(req.params.id)
      .populate('course', 'name subject type')
      .populate('teacher', 'firstName lastName nickname')
      .populate('students', 'firstName lastName nickname email grade academicYear');

    if (!schedule) return sendResponse(res, 404, false, null, 'Schedule not found');

    // เฉพาะคลาสกลุ่มเท่านั้น
    if (schedule.course?.type !== 'group') {
      return sendResponse(res, 400, false, null, 'ส่งลิ้งค์ได้เฉพาะคลาสกลุ่มเท่านั้น');
    }

    const teacherName = `${schedule.teacher?.firstName || ''} ${schedule.teacher?.lastName || ''}`.trim();
    const courseName = schedule.course?.name || schedule.course?.subject || 'คอร์สเรียน';

    const results = [];
    for (const student of schedule.students) {
      if (!student.email) continue;
      const result = await sendVideoLinkEmail({
        studentEmail: student.email,
        studentName: `${student.firstName} ${student.lastName}`,
        teacherName,
        courseName,
        date: schedule.date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        videoLink
      });
      results.push(result);
    }

    sendResponse(res, 200, true, { sent: results.length, results }, `ส่งลิ้งค์ VDO ไปยัง ${results.length} คนเรียบร้อยแล้ว`);
  } catch (error) {
    console.error('Send video link error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
