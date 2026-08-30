const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Course = require('../models/Course');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const { deriveDisplayStatus } = require('../utils/scheduleAggregation');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject } = require('../utils/helpers');
const {
  sendCourseCreatedTeacherEmail, sendCourseCreatedStudentEmail, sendCourseAcceptedEmail,
  sendScheduleEditedTeacherEmail, sendScheduleEditedStudentEmail
} = require('../services/emailService');
const { reverseCompletedScheduleHours } = require('../services/hoursService');

// ── Recurrence generator (แบบ Google Calendar) ─────────────────────────────
// รับ baseDate + recurrence config → คืน array ของวันที่ทั้งหมดที่จะนัดสอน
// (รวมวันแรกเสมอ). รองรับ frequency: daily | weekly | monthly, interval,
// weekdays (เฉพาะ weekly), และเงื่อนไขจบ endType: count | until.
const MAX_RECURRENCE = 60; // เพดานกันสร้างเกิน (safety cap)
function computeRecurrenceDates(baseDate, recurrence) {
  const base = new Date(baseDate);
  if (!recurrence || !['daily', 'weekly', 'monthly'].includes(recurrence.frequency)) {
    return [base];
  }

  const interval = Math.max(1, parseInt(recurrence.interval, 10) || 1);
  const endType  = ['never', 'until', 'count'].includes(recurrence.endType) ? recurrence.endType : 'count';
  const count    = Math.min(MAX_RECURRENCE, Math.max(1, parseInt(recurrence.count, 10) || 1));
  const until    = recurrence.until ? new Date(recurrence.until) : null;
  if (until) until.setHours(23, 59, 59, 999);

  const dates = [];
  const reachedEnd = (d) => {
    if (endType === 'until') return until ? d > until : dates.length >= MAX_RECURRENCE;
    if (endType === 'never') return dates.length >= MAX_RECURRENCE;
    return dates.length >= count;
  };

  if (recurrence.frequency === 'daily') {
    let d = new Date(base);
    while (!reachedEnd(d) && dates.length < MAX_RECURRENCE) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + interval);
    }
  } else if (recurrence.frequency === 'weekly') {
    // weekdays: 0=อาทิตย์..6=เสาร์ — ไม่ระบุ → ใช้วันของ base
    let weekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length > 0
      ? [...new Set(recurrence.weekdays.map(Number))].filter(n => n >= 0 && n <= 6).sort((a, b) => a - b)
      : [base.getDay()];
    // เริ่มที่วันอาทิตย์ของสัปดาห์ที่มี base
    let weekStart = new Date(base);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    let guard = 0;
    outer:
    while (guard++ < 400) {
      for (const wd of weekdays) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + wd);
        if (d < base) continue;                 // ข้ามวันก่อนวันเริ่ม
        if (reachedEnd(d)) break outer;
        dates.push(new Date(d));
        if (dates.length >= MAX_RECURRENCE) break outer;
      }
      weekStart.setDate(weekStart.getDate() + 7 * interval);
    }
  } else { // monthly — วันเดียวกันของเดือน (JS จัดการวันล้นเดือนเอง)
    let n = 0;
    while (dates.length < MAX_RECURRENCE) {
      const d = new Date(base.getFullYear(), base.getMonth() + n * interval, base.getDate(),
                         base.getHours(), base.getMinutes());
      if (reachedEnd(d)) break;
      dates.push(d);
      n++;
    }
  }

  return dates.length > 0 ? dates : [base];
}

// =====================================================
// POST / — Manager สร้างคอร์สการสอนใหม่
// =====================================================
router.post('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const {
      name, description, subject, teacher, students,
      scheduledDate, startTime, endTime,
      type, difficulty, gradeLevel,
      maxStudents, price,
      teacherIncomeIndividual, teacherIncomeGroup, coursePrice,
      teachingType,
      repeatWeeklyUntilEndOfMonth,
      recurrence,
      isCoursePackage
    } = req.body;

    // Validate required fields
    if (!subject || !teacher || !scheduledDate || !startTime || !endTime) {
      return sendResponse(res, 400, false, null, 'กรุณากรอกข้อมูลให้ครบถ้วน (วิชา, ครู, วันที่, เวลา)');
    }

    // Validate teacher — allow both teacher and manager roles (managers can also teach)
    const teacherUser = await User.findById(teacher);
    if (!teacherUser || !['teacher', 'manager'].includes(teacherUser.role)) {
      return sendResponse(res, 400, false, null, 'ไม่พบครู/ผู้จัดการที่เลือก');
    }

    // Validate students
    const studentIds = Array.isArray(students) ? students : [];
    let studentUsers = [];
    if (studentIds.length > 0) {
      studentUsers = await User.find({ _id: { $in: studentIds }, role: 'student' });
      if (studentUsers.length !== studentIds.length) {
        return sendResponse(res, 400, false, null, 'พบนักเรียนบางคนไม่ถูกต้อง');
      }
    }

    // ── คำนวณวันที่ทั้งหมดของชุดนัดสอน ──
    // ใหม่: recurrence config แบบ Google Calendar (frequency/interval/weekdays/end)
    // เดิม (backward compat): repeatWeeklyUntilEndOfMonth = ทำซ้ำทุก 7 วันจนสิ้นเดือน
    const baseDate = new Date(scheduledDate);
    let scheduleDates;
    if (recurrence && ['daily', 'weekly', 'monthly'].includes(recurrence.frequency)) {
      scheduleDates = computeRecurrenceDates(baseDate, recurrence);
    } else if (repeatWeeklyUntilEndOfMonth) {
      const baseMonth = baseDate.getMonth();
      const baseYear  = baseDate.getFullYear();
      const lastDay   = new Date(baseYear, baseMonth + 1, 0);
      scheduleDates = [new Date(baseDate)];
      const next = new Date(baseDate);
      next.setDate(next.getDate() + 7);
      while (next.getMonth() === baseMonth && next <= lastDay) {
        scheduleDates.push(new Date(next));
        next.setDate(next.getDate() + 7);
      }
    } else {
      scheduleDates = [new Date(baseDate)];
    }

    // สร้าง Course + Schedule + Enrollment 1 ชุด ต่อ 1 วันนัด
    // ทำให้ทั้ง "การจัดการรายวิชา" และ "ประวัติการสอน" มีจำนวนตรงกัน
    const createdCourses = [];
    const createdSchedules = [];

    // ── ชุดนัดสอนอัตโนมัติ ── เมื่อ repeat สร้างได้มากกว่า 1 ครั้ง ให้ stamp seriesId เดียวกันทั้งชุด
    const isSeries = scheduleDates.length > 1;
    const seriesId = isSeries ? new mongoose.Types.ObjectId().toString() : null;
    const seriesSize = scheduleDates.length;

    for (const dt of scheduleDates) {
      // Course หนึ่งตัวต่อหนึ่งวันนัด
      const c = new Course({
        name: name || `${subject} — ${teacherUser.firstName} ${teacherUser.lastName}`,
        description: description || '',
        subject,
        teacher,
        students: studentIds,
        scheduledDate: dt,
        startTime,
        endTime,
        type: type || 'group',
        difficulty: difficulty || '',
        teachingType: teachingType || '',
        gradeLevel: gradeLevel || '',
        maxStudents: maxStudents || studentIds.length || 1,
        price: price || 0,
        teacherIncomeIndividual: Number(teacherIncomeIndividual) || 0,
        teacherIncomeGroup:      Number(teacherIncomeGroup) || 0,
        coursePrice:             Number(coursePrice) || 0,
        incomeHourly:            true,   // โค้ดใหม่: คิดรายได้ต่อชั่วโมง × duration
        seriesId,
        seriesSize,
        isCoursePackage:         !!isCoursePackage,
        status: 'pending',
        createdBy: req.user.id
      });
      await c.save();
      createdCourses.push(c);

      // Schedule หนึ่งตัวต่อหนึ่งวันนัด (อ้างอิง Course เดียวกันต่อวัน)
      const sch = new Schedule({
        course: c._id,
        teacher,
        students: studentIds,
        date: dt,
        startTime,
        endTime,
        status: 'pending',
        teacherConfirmed: false,
        teacherIncomeIndividual: Number(teacherIncomeIndividual) || 0,
        teacherIncomeGroup:      Number(teacherIncomeGroup) || 0,
        coursePrice:             Number(coursePrice) || 0,
        incomeHourly:            true,   // โค้ดใหม่: คิดรายได้ต่อชั่วโมง × duration
        studentConfirmations: studentIds.map(sid => ({
          student: sid, status: 'pending', confirmedAt: null
        }))
      });
      await sch.save();
      createdSchedules.push(sch);

      // Enrollment สำหรับนักเรียนแต่ละคนของ Course นี้
      for (const studentId of studentIds) {
        const existingEnrollment = await Enrollment.findOne({ student: studentId, course: c._id });
        if (!existingEnrollment) {
          const enrollment = new Enrollment({
            student: studentId,
            course: c._id,
            enrolledBy: req.user.id,
            status: 'pending'
          });
          await enrollment.save();
        }
      }
    }

    // เก็บ Course แรกสำหรับ response/notification (compatible กับโค้ดเดิม)
    const course = createdCourses[0];
    const schedule = createdSchedules[0];

    // ── ส่ง Notification ในเว็บ ──
    const dateFormatted = new Date(scheduledDate).toLocaleDateString('th-TH', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
    const studentNameList = studentUsers.map(s => `${s.firstName} ${s.lastName}`).join(', ');
    const recurrenceNote = createdSchedules.length > 1
      ? ` (ทำซ้ำรายสัปดาห์ ${createdSchedules.length} ครั้ง จนถึงสิ้นเดือน)`
      : '';

    // Notification → Teacher
    await new Notification({
      recipient: teacher,
      sender: req.user.id,
      type: 'course',
      title: 'นัดสอนใหม่รอการยืนยัน',
      message: `วิชา: ${subject} | วันที่: ${dateFormatted} ${startTime}–${endTime}${recurrenceNote} | นักเรียน: ${studentNameList || 'ยังไม่ระบุ'}`,
      relatedId: course._id
    }).save();

    // Notification → นักเรียนแต่ละคน
    for (const studentId of studentIds) {
      await new Notification({
        recipient: studentId,
        sender: req.user.id,
        type: 'course',
        title: 'มีการนัดสอนใหม่',
        message: `วิชา: ${subject} | ครู: ${teacherUser.firstName} ${teacherUser.lastName} | วันที่: ${dateFormatted} ${startTime}–${endTime}${recurrenceNote}`,
        relatedId: course._id
      }).save();
    }

    // Notification → Manager/Admin ที่สร้าง (ยืนยันว่าสร้างสำเร็จ)
    if (req.user.id !== teacher.toString()) {
      await new Notification({
        recipient: req.user.id,
        sender: req.user.id,
        type: 'course',
        title: 'สร้างนัดสอนสำเร็จ',
        message: `วิชา: ${subject} | ครู: ${teacherUser.firstName} ${teacherUser.lastName} | วันที่: ${dateFormatted}${recurrenceNote} (รอการยืนยันจากครู)`,
        relatedId: course._id
      }).save();
    }

    // ── ส่ง Email แยกครู / นักเรียน ──
    const teacherName = `${teacherUser.firstName} ${teacherUser.lastName}`;
    const studentNames = studentUsers.map(s => `${s.firstName} ${s.lastName}`);
    const emailBase = {
      courseName: course.name,
      subject,
      teacherName,
      studentNames,
      scheduledDate,
      startTime,
      endTime,
      courseType: type || 'group',
      teachingType: teachingType || '',
      gradeLevel: gradeLevel || ''
    };

    // อีเมลครู — แสดงรายได้ที่จะได้รับ
    sendCourseCreatedTeacherEmail({
      ...emailBase,
      recipient: { email: teacherUser.email },
      teacherIncomeIndividual: Number(teacherIncomeIndividual) || 0,
      teacherIncomeGroup:      Number(teacherIncomeGroup) || 0
    }).catch(err => console.error('[EmailService] Teacher email error:', err));

    // อีเมลนักเรียน — แสดงราคาที่ต้องจ่าย
    if (studentUsers.length > 0) {
      sendCourseCreatedStudentEmail({
        ...emailBase,
        recipients: studentUsers.map(s => ({ email: s.email })),
        coursePrice: Number(coursePrice) || 0
      }).catch(err => console.error('[EmailService] Student email error:', err));
    }

    await course.populate('teacher', 'firstName lastName nickname email');
    await course.populate('students', 'firstName lastName nickname email grade academicYear');
    await course.populate('createdBy', 'firstName lastName nickname');

    const successMsg = createdCourses.length > 1
      ? `สร้างนัดสอนสำเร็จ ${createdCourses.length} รายวิชา (ทำซ้ำรายสัปดาห์จนถึงสิ้นเดือน) — รอการยืนยันจากครู`
      : 'สร้างนัดสอนสำเร็จ — รอการยืนยันจากครู';
    sendResponse(res, 201, true, course, successMsg);
  } catch (error) {
    console.error('Create course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// GET / — ดึงรายการคอร์สทั้งหมด
// =====================================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { status, subject, teacher, search } = req.query;

    let query = {};

    if (req.user.role === 'teacher') {
      query.teacher = req.user.id;
    } else if (req.user.role === 'student') {
      query.students = { $in: [req.user.id] };
    }

    if (status) query.status = status;
    if (subject) query.subject = { $regex: subject, $options: 'i' };
    if (teacher) query.teacher = teacher;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { subject: { $regex: search, $options: 'i' } }
    ];

    const total = await Course.countDocuments(query);
    const courses = await Course.find(query)
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('createdBy', 'firstName lastName nickname')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    // ── Attach displayStatus from related Schedule (latest one per course) ──
    // ทำให้ course-management แสดงสถานะตรงกับ calendar/history
    const courseIds = courses.map(c => c._id);
    const schedules = await Schedule.find({ course: { $in: courseIds } })
      .select('_id course status teacherConfirmed isFullyConfirmed students date')
      .sort({ date: -1 });

    // หาชี้ลด schedule ล่าสุดต่อ course
    const latestScheduleByCourseId = new Map();
    for (const sch of schedules) {
      const cid = sch.course.toString();
      if (!latestScheduleByCourseId.has(cid)) {
        latestScheduleByCourseId.set(cid, sch);
      }
    }

    const result = courses.map(c => {
      const sch = latestScheduleByCourseId.get(c._id.toString());
      return {
        ...c.toObject(),
        scheduleId: sch ? sch._id.toString() : null,
        displayStatus: deriveDisplayStatus(sch || { status: c.status, teacherConfirmed: c.teacherAccepted, isFullyConfirmed: false, students: c.students })
      };
    });

    sendResponse(res, 200, true, result, 'Courses retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get courses error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// GET /teacher/:teacherId — คอร์สของครู
// =====================================================
router.get('/teacher/:teacherId', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);

    const total = await Course.countDocuments({ teacher: req.params.teacherId });
    const courses = await Course.find({ teacher: req.params.teacherId })
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('createdBy', 'firstName lastName nickname')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, courses, 'Teacher courses retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get teacher courses error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// GET /meta/subjects — ดึงรายการวิชาที่เคยสร้างมาแล้ว (distinct)
// =====================================================
router.get('/meta/subjects', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const subjects = await Course.distinct('subject', { subject: { $nin: [null, ''] } });
    sendResponse(res, 200, true, subjects.sort(), 'Subjects retrieved');
  } catch (error) {
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// GET /meta/teaching-types — ดึงประเภทการสอนที่เคยสร้างมา (distinct)
// =====================================================
router.get('/meta/teaching-types', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const types = await Course.distinct('teachingType', { teachingType: { $nin: [null, ''] } });
    sendResponse(res, 200, true, types.sort(), 'Teaching types retrieved');
  } catch (error) {
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// GET /:id — ดึงข้อมูลคอร์ส
// =====================================================
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('teacher', 'firstName lastName nickname email phone bio subjects teachingHours')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('createdBy', 'firstName lastName nickname');

    if (!course) {
      return sendResponse(res, 404, false, null, 'Course not found');
    }

    const enrollmentCount = await Enrollment.countDocuments({ course: req.params.id, status: 'active' });

    sendResponse(res, 200, true, {
      ...course.toObject(),
      enrolledStudents: enrollmentCount
    }, 'Course retrieved');
  } catch (error) {
    console.error('Get course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// PUT /:id — แก้ไขคอร์ส (Manager/Admin)
// =====================================================
router.put('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { name, description, subject, maxStudents, schedule, price, status, type, difficulty, gradeLevel } = req.body;

    const course = await Course.findById(req.params.id);
    if (!course) {
      return sendResponse(res, 404, false, null, 'Course not found');
    }

    if (name) course.name = name;
    if (description) course.description = description;
    if (subject) course.subject = subject;
    if (maxStudents) course.maxStudents = maxStudents;
    if (schedule) course.schedule = schedule;
    if (price !== undefined) course.price = price;
    if (type) course.type = type;
    if (difficulty) course.difficulty = difficulty;
    if (gradeLevel) course.gradeLevel = gradeLevel;
    if (status && ['pending', 'approved', 'active', 'completed', 'cancelled'].includes(status)) {
      course.status = status;
    }

    await course.save();
    await course.populate('teacher', 'firstName lastName nickname email');
    await course.populate('students', 'firstName lastName nickname email grade academicYear');

    sendResponse(res, 200, true, course, 'Course updated');
  } catch (error) {
    console.error('Update course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// PUT /:id/accept — ครู/Manager ยืนยันรับการสอน
// =====================================================
router.put('/:id/accept', authenticateToken, roleCheck(['teacher', 'manager', 'admin']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear')
      .populate('createdBy', 'firstName lastName nickname email');

    if (!course) {
      return sendResponse(res, 404, false, null, 'Course not found');
    }

    const isTeacher = course.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);
    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'ไม่มีสิทธิ์ยืนยันคอร์สนี้');
    }

    // อัพเดต Course (course-level acceptance)
    course.teacherAccepted = true;
    course.status = 'approved';
    await course.save();

    // ── Q3: ครูต้องยืนยัน Schedule แต่ละตัวแยกกัน ──
    // ไม่ bulk-update Schedule.teacherConfirmed อีกต่อไป
    // (ครูต้องไปกดยืนยันที่ปฏิทินทีละ session)
    // อย่างไรก็ตาม — ถ้า course นี้มี schedule เดียว ก็ถือว่ายืนยันให้ schedule นั้นเลย
    // เพื่อให้ flow ราบรื่นในกรณีปกติ (1 course = 1 schedule)
    const scheduleCount = await Schedule.countDocuments({ course: course._id, status: { $ne: 'cancelled' } });
    if (scheduleCount === 1) {
      const onlySchedule = await Schedule.findOne({ course: course._id, status: { $ne: 'cancelled' } });
      if (onlySchedule && !onlySchedule.teacherConfirmed) {
        onlySchedule.teacherConfirmed = true;
        onlySchedule.teacherConfirmedAt = new Date();
        if (onlySchedule.status === 'pending') onlySchedule.status = 'confirmed';
        await onlySchedule.save();
      }
    }

    // อัพเดต Enrollment → active
    await Enrollment.updateMany(
      { course: course._id, status: 'pending' },
      { $set: { status: 'active' } }
    );

    const teacherName = `${course.teacher.firstName} ${course.teacher.lastName}`;
    const dateFormatted = course.scheduledDate
      ? new Date(course.scheduledDate).toLocaleDateString('th-TH', {
          weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        })
      : 'ไม่ระบุวันที่';

    // ── Notification → นักเรียนแต่ละคน ──
    for (const student of course.students) {
      await new Notification({
        recipient: student._id,
        sender: req.user.id,
        type: 'course',
        title: '✅ ครูยืนยันนัดสอนแล้ว',
        message: `วิชา: ${course.subject} | ครู: ${teacherName} | วันที่: ${dateFormatted} ${course.startTime}–${course.endTime} (ถูกเพิ่มในปฏิทินของคุณแล้ว)`,
        relatedId: course._id
      }).save();
    }

    // ── Notification → Manager/Admin ที่สร้าง ──
    if (course.createdBy) {
      await new Notification({
        recipient: course.createdBy._id,
        sender: req.user.id,
        type: 'course',
        title: '✅ ครูยืนยันนัดสอนแล้ว',
        message: `${teacherName} ยืนยันรับสอน วิชา: ${course.subject} | วันที่: ${dateFormatted} ${course.startTime}–${course.endTime}`,
        relatedId: course._id
      }).save();
    }

    // ── ส่ง Email ──
    const allEmailRecipients = [
      { email: course.createdBy?.email, name: course.createdBy?.firstName },
      ...course.students.map(s => ({ email: s.email, name: `${s.firstName} ${s.lastName}` }))
    ].filter(r => r.email);

    sendCourseAcceptedEmail({
      recipients: allEmailRecipients,
      courseName: course.name,
      subject: course.subject,
      teacherName,
      scheduledDate: course.scheduledDate,
      startTime: course.startTime,
      endTime: course.endTime
    }).catch(err => console.error('[EmailService] Email error:', err));

    sendResponse(res, 200, true, course, 'ยืนยันการสอนสำเร็จ — ถูกเพิ่มในปฏิทินทุกฝ่ายแล้ว');
  } catch (error) {
    console.error('Accept course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// PUT /:id/reject — ครู/Manager ปฏิเสธการสอน
// =====================================================
router.put('/:id/reject', authenticateToken, roleCheck(['teacher', 'manager', 'admin']), async (req, res) => {
  try {
    const { reason } = req.body;
    const course = await Course.findById(req.params.id)
      .populate('teacher', 'firstName lastName nickname')
      .populate('createdBy', 'firstName lastName nickname');

    if (!course) {
      return sendResponse(res, 404, false, null, 'Course not found');
    }

    const isTeacher = course.teacher._id.toString() === req.user.id;
    const isManagerOrAdmin = ['manager', 'admin'].includes(req.user.role);
    if (!isTeacher && !isManagerOrAdmin) {
      return sendResponse(res, 403, false, null, 'ไม่มีสิทธิ์ปฏิเสธคอร์สนี้');
    }

    course.status = 'cancelled';
    await course.save();

    // Cancel schedule
    await Schedule.updateMany(
      { course: course._id },
      { $set: { status: 'cancelled' } }
    );

    // Cancel enrollments
    await Enrollment.updateMany(
      { course: course._id },
      { $set: { status: 'cancelled' } }
    );

    const teacherName = `${course.teacher.firstName} ${course.teacher.lastName}`;

    // Notification → Manager
    if (course.createdBy) {
      await new Notification({
        recipient: course.createdBy._id,
        sender: req.user.id,
        type: 'course',
        title: '❌ ครูปฏิเสธนัดสอน',
        message: `${teacherName} ปฏิเสธการสอนวิชา: ${course.subject}${reason ? ` — เหตุผล: ${reason}` : ''}`,
        relatedId: course._id
      }).save();
    }

    sendResponse(res, 200, true, course, 'ปฏิเสธการสอนเรียบร้อย');
  } catch (error) {
    console.error('Reject course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// DELETE /:id — ยกเลิกคอร์ส (Manager/Admin)
// =====================================================
// =====================================================
// PATCH /:id/edit-booking — แก้ไขรายละเอียดนัดสอน + อัพเดต Schedule + ส่งอีเมล
// =====================================================
router.patch('/:id/edit-booking', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const {
      scheduledDate, startTime, endTime,
      subject, teachingType, gradeLevel, description,
      teacher,
      teacherIncomeIndividual, teacherIncomeGroup, coursePrice,
      scope   // 'this' (default) | 'following' | 'all' — ขอบเขตแก้ไขชุดนัดสอน
    } = req.body;

    // duration (นาที) จากช่วงเวลา — ใช้ sync totalDurationMinutes ตอนแก้เวลาผ่าน updateMany
    const durationFromTimes = (st, et) => {
      if (!st || !et) return null;
      const [sh, sm] = String(st).split(':').map(Number);
      const [eh, em] = String(et).split(':').map(Number);
      if ([sh, sm, eh, em].some(n => isNaN(n))) return null;
      let d = (eh * 60 + em) - (sh * 60 + sm);
      if (d <= 0) d += 24 * 60; // ข้ามเที่ยงคืน
      return d > 0 ? d : null;
    };

    const course = await Course.findById(req.params.id)
      .populate('teacher', 'firstName lastName nickname email')
      .populate('students', 'firstName lastName nickname email grade academicYear');

    if (!course) return sendResponse(res, 404, false, null, 'Course not found');
    if (course.status === 'cancelled') {
      return sendResponse(res, 400, false, null, 'ไม่สามารถแก้ไขนัดสอนที่ถูกยกเลิกแล้ว');
    }

    // บันทึกค่าเดิมก่อนแก้ไข (สำหรับส่งอีเมลเปรียบเทียบ)
    const oldDate      = course.scheduledDate;
    const oldStartTime = course.startTime;
    const oldEndTime   = course.endTime;

    // อัพเดต Course
    if (scheduledDate !== undefined) course.scheduledDate = new Date(scheduledDate);
    if (startTime     !== undefined) course.startTime     = startTime;
    if (endTime       !== undefined) course.endTime       = endTime;
    if (subject       !== undefined) course.subject       = subject;
    if (teachingType  !== undefined) course.teachingType  = teachingType;
    if (gradeLevel    !== undefined) course.gradeLevel    = gradeLevel;
    if (description   !== undefined) course.description   = description;
    if (teacher       !== undefined) course.teacher       = teacher;
    if (teacherIncomeIndividual !== undefined) course.teacherIncomeIndividual = Number(teacherIncomeIndividual);
    if (teacherIncomeGroup      !== undefined) course.teacherIncomeGroup      = Number(teacherIncomeGroup);
    if (coursePrice             !== undefined) course.coursePrice             = Number(coursePrice);

    await course.save();

    // ── อัพเดต Schedule ที่เชื่อมกับ Course นี้ ──
    // แยกเป็น 2 ชั้น เพื่อให้แก้ราคาคลาสที่จบไปแล้วทำได้ (correction) แต่
    // ไม่อนุญาตเปลี่ยนวัน/เวลา/ครูของคลาสที่จบแล้ว เพราะกระทบสถานะการยืนยัน

    // ── 1) Price/income ── sync ทุก schedule รวมถึงที่ completed/awaiting_confirmation
    //    (เพื่อให้ revenue/history แสดงราคาตรงกับ course management หลังแก้ไข)
    const priceUpdate = {};
    if (teacherIncomeIndividual !== undefined) priceUpdate.teacherIncomeIndividual = Number(teacherIncomeIndividual);
    if (teacherIncomeGroup      !== undefined) priceUpdate.teacherIncomeGroup      = Number(teacherIncomeGroup);
    if (coursePrice             !== undefined) priceUpdate.coursePrice             = Number(coursePrice);
    if (Object.keys(priceUpdate).length > 0) {
      await Schedule.updateMany(
        { course: course._id, status: { $ne: 'cancelled' } },
        { $set: priceUpdate }
      );
    }

    // ── 1b) Recompute actualTeacherIncome snapshot for finished schedules ──
    //    actualTeacherIncome is frozen when the class closes; if the manager
    //    corrects the teacher rate afterwards the snapshot must be re-derived,
    //    otherwise history/revenue keep showing the old income.
    if (teacherIncomeIndividual !== undefined || teacherIncomeGroup !== undefined) {
      const { computeEffectiveTeacherIncome } = require('../utils/helpers');
      const finished = await Schedule.find({
        course: course._id,
        status: { $in: ['completed', 'awaiting_confirmation'] }
      });
      for (const sch of finished) {
        const attendanceCount = await Attendance.countDocuments({ schedule: sch._id });
        sch.actualTeacherIncome = computeEffectiveTeacherIncome(sch, attendanceCount);
        await sch.save();
      }
    }

    // ── 2) Date/time/teacher ── sync เฉพาะ schedule ที่ยังไม่ completed/cancelled
    //    + reset teacherConfirmed เมื่อมีการเปลี่ยนวัน/เวลา/ครู
    const scheduleUpdate = {};
    if (scheduledDate !== undefined) scheduleUpdate.date      = new Date(scheduledDate);
    if (startTime     !== undefined) scheduleUpdate.startTime = startTime;
    if (endTime       !== undefined) scheduleUpdate.endTime   = endTime;
    if (teacher       !== undefined) scheduleUpdate.teacher   = teacher;
    // sync duration เมื่อแก้เวลา (updateMany bypass pre-save hook)
    const anchorDur = durationFromTimes(course.startTime, course.endTime);
    if ((startTime !== undefined || endTime !== undefined) && anchorDur) scheduleUpdate.totalDurationMinutes = anchorDur;

    const significantChange =
      scheduledDate !== undefined ||
      startTime     !== undefined ||
      endTime       !== undefined ||
      teacher       !== undefined;
    if (significantChange) {
      scheduleUpdate.teacherConfirmed   = false;
      scheduleUpdate.teacherConfirmedAt = null;
      scheduleUpdate.status             = 'pending'; // กลับไปรอครูยืนยัน
      // Reset Course-level acceptance ด้วย (ครูคนใหม่ยังไม่ได้รับ)
      course.teacherAccepted = false;
      if (course.status === 'approved') course.status = 'pending';
      await course.save();
    }

    if (Object.keys(scheduleUpdate).length > 0) {
      await Schedule.updateMany(
        { course: course._id, status: { $nin: ['cancelled', 'completed', 'awaiting_confirmation'] } },
        { $set: scheduleUpdate }
      );
    }

    // ── Series scope ── กระจายการแก้ไปยังคลาสอื่นในชุด (this and following / all)
    //   ไม่กระจาย scheduledDate — แต่ละคลาสคงวันของตัวเอง (เปลี่ยนแค่ "เวลา" และรายละเอียด)
    let spreadCount = 0;
    if (scope && scope !== 'this' && course.seriesId) {
      const courseSpread = {};
      if (startTime    !== undefined) courseSpread.startTime    = startTime;
      if (endTime      !== undefined) courseSpread.endTime      = endTime;
      if (subject      !== undefined) courseSpread.subject      = subject;
      if (teachingType !== undefined) courseSpread.teachingType = teachingType;
      if (gradeLevel   !== undefined) courseSpread.gradeLevel   = gradeLevel;
      if (description  !== undefined) courseSpread.description  = description;
      if (teacher      !== undefined) courseSpread.teacher      = teacher;
      if (teacherIncomeIndividual !== undefined) courseSpread.teacherIncomeIndividual = Number(teacherIncomeIndividual);
      if (teacherIncomeGroup      !== undefined) courseSpread.teacherIncomeGroup      = Number(teacherIncomeGroup);
      if (coursePrice             !== undefined) courseSpread.coursePrice             = Number(coursePrice);

      const siblingFilter = { seriesId: course.seriesId, _id: { $ne: course._id }, status: { $ne: 'cancelled' } };
      if (scope === 'following') siblingFilter.scheduledDate = { $gte: oldDate };

      const siblingIds = (await Course.find(siblingFilter).select('_id')).map(s => s._id);
      spreadCount = siblingIds.length;

      if (siblingIds.length > 0 && Object.keys(courseSpread).length > 0) {
        await Course.updateMany({ _id: { $in: siblingIds } }, { $set: courseSpread });

        // Schedule: price sync ทุกสถานะ (ยกเว้น cancelled)
        const sPrice = {};
        if (courseSpread.teacherIncomeIndividual !== undefined) sPrice.teacherIncomeIndividual = courseSpread.teacherIncomeIndividual;
        if (courseSpread.teacherIncomeGroup      !== undefined) sPrice.teacherIncomeGroup      = courseSpread.teacherIncomeGroup;
        if (courseSpread.coursePrice             !== undefined) sPrice.coursePrice             = courseSpread.coursePrice;
        if (Object.keys(sPrice).length > 0) {
          await Schedule.updateMany({ course: { $in: siblingIds }, status: { $ne: 'cancelled' } }, { $set: sPrice });
        }

        // Schedule: time/teacher sync เฉพาะที่ยังไม่จบ + reset การยืนยันครู
        const sTime = {};
        if (startTime !== undefined) sTime.startTime = startTime;
        if (endTime   !== undefined) sTime.endTime   = endTime;
        if (teacher   !== undefined) sTime.teacher   = teacher;
        const spreadDur = durationFromTimes(startTime ?? course.startTime, endTime ?? course.endTime);
        if ((startTime !== undefined || endTime !== undefined) && spreadDur) sTime.totalDurationMinutes = spreadDur;
        const sig = startTime !== undefined || endTime !== undefined || teacher !== undefined;
        if (sig) { sTime.teacherConfirmed = false; sTime.teacherConfirmedAt = null; sTime.status = 'pending'; }
        if (Object.keys(sTime).length > 0) {
          await Schedule.updateMany(
            { course: { $in: siblingIds }, status: { $nin: ['cancelled', 'completed', 'awaiting_confirmation'] } },
            { $set: sTime }
          );
        }
        if (sig) {
          await Course.updateMany(
            { _id: { $in: siblingIds }, status: 'approved' },
            { $set: { teacherAccepted: false, status: 'pending' } }
          );
        }
      }
    }

    // โหลดข้อมูลใหม่หลัง save
    await course.populate('teacher', 'firstName lastName nickname email');
    await course.populate('students', 'firstName lastName nickname email grade academicYear');

    // ส่ง Notification
    const teacherObj  = course.teacher;
    const studentObjs = course.students;
    const newDateFmt  = new Date(course.scheduledDate).toLocaleDateString('th-TH', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
    const teacherName = `${teacherObj.firstName} ${teacherObj.lastName}`;

    if (teacherObj._id) {
      await new Notification({
        recipient: teacherObj._id,
        sender:    req.user.id,
        type:      'course',
        title:     '✏️ รายละเอียดนัดสอนถูกแก้ไข',
        message:   `วิชา: ${course.subject} | เวลาใหม่: ${newDateFmt} ${course.startTime}–${course.endTime}`,
        relatedId: course._id
      }).save();
    }
    for (const student of studentObjs) {
      await new Notification({
        recipient: student._id,
        sender:    req.user.id,
        type:      'course',
        title:     '✏️ รายละเอียดนัดสอนถูกแก้ไข',
        message:   `วิชา: ${course.subject} | เวลาใหม่: ${newDateFmt} ${course.startTime}–${course.endTime}`,
        relatedId: course._id
      }).save();
    }

    // ส่งอีเมล
    const emailBase = {
      courseName:    course.name,
      subject:       course.subject,
      teacherName,
      oldDate,
      oldStartTime,
      oldEndTime,
      newDate:       course.scheduledDate,
      newStartTime:  course.startTime,
      newEndTime:    course.endTime,
      courseType:    course.type
    };

    sendScheduleEditedTeacherEmail({
      ...emailBase,
      recipient: { email: teacherObj.email },
      teacherIncomeIndividual: course.teacherIncomeIndividual || 0,
      teacherIncomeGroup:      course.teacherIncomeGroup || 0
    }).catch(e => console.error('[Email] EditTeacher error:', e));

    if (studentObjs.length > 0) {
      sendScheduleEditedStudentEmail({
        ...emailBase,
        recipients:  studentObjs.map(s => ({ email: s.email })),
        coursePrice: course.coursePrice || 0
      }).catch(e => console.error('[Email] EditStudent error:', e));
    }

    const spreadMsg = spreadCount > 0 ? ` (ปรับใช้กับอีก ${spreadCount} คลาสในชุด)` : '';
    sendResponse(res, 200, true, course, `แก้ไขนัดสอนสำเร็จ${spreadMsg} — ส่งอีเมลแจ้งเตือนแล้ว`);
  } catch (error) {
    console.error('Edit booking error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// DELETE /:id/permanent — ลบนัดสอนออกถาวร (เฉพาะที่ถูกยกเลิกแล้ว)
// =====================================================
router.delete('/:id/permanent', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return sendResponse(res, 404, false, null, 'Course not found');

    if (course.status !== 'cancelled') {
      return sendResponse(res, 400, false, null, 'ลบได้เฉพาะนัดสอนที่ถูกยกเลิกแล้วเท่านั้น กรุณายกเลิกก่อน');
    }

    // กันชั่วโมงสะสมค้าง: ถ้ามี schedule ที่ยัง completed อยู่ (ไม่ได้ถูกย้อนตอน cancel) ให้ย้อนก่อนลบ
    const stillCompleted = await Schedule.find({ course: course._id, status: 'completed' });
    for (const sch of stillCompleted) {
      await reverseCompletedScheduleHours(sch);
    }

    await Schedule.deleteMany({ course: course._id });
    await Enrollment.deleteMany({ course: course._id });
    await Course.findByIdAndDelete(req.params.id);

    sendResponse(res, 200, true, null, 'ลบนัดสอนออกจากระบบเรียบร้อยแล้ว');
  } catch (error) {
    console.error('Permanent delete course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// =====================================================
// DELETE /:id — ยกเลิกนัดสอน (ตั้ง status = 'cancelled')
// =====================================================
router.delete('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );

    if (!course) {
      return sendResponse(res, 404, false, null, 'Course not found');
    }

    // ย้อนชั่วโมงสะสมของคลาสที่ completed ก่อนเปลี่ยนสถานะเป็น cancelled
    const completedSchedules = await Schedule.find({ course: req.params.id, status: 'completed' });
    for (const sch of completedSchedules) {
      await reverseCompletedScheduleHours(sch);
    }

    // Cancel related schedules and enrollments
    await Schedule.updateMany({ course: req.params.id }, { $set: { status: 'cancelled' } });
    await Enrollment.updateMany({ course: req.params.id }, { $set: { status: 'cancelled' } });

    sendResponse(res, 200, true, course, 'Course cancelled');
  } catch (error) {
    console.error('Delete course error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
