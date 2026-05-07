const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Schedule = require('../models/Schedule');
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
      repeatWeeklyUntilEndOfMonth
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

    // ── คำนวณวันที่ทั้งหมด: ถ้าติ๊ก repeatWeeklyUntilEndOfMonth → ทำซ้ำทุก 7 วันจนถึงสิ้นเดือนเดียวกัน ──
    const baseDate = new Date(scheduledDate);
    const scheduleDates = [new Date(baseDate)];
    if (repeatWeeklyUntilEndOfMonth) {
      const baseMonth = baseDate.getMonth();
      const baseYear  = baseDate.getFullYear();
      const lastDay   = new Date(baseYear, baseMonth + 1, 0);
      const next = new Date(baseDate);
      next.setDate(next.getDate() + 7);
      while (next.getMonth() === baseMonth && next <= lastDay) {
        scheduleDates.push(new Date(next));
        next.setDate(next.getDate() + 7);
      }
    }

    // สร้าง Course + Schedule + Enrollment 1 ชุด ต่อ 1 วันนัด
    // ทำให้ทั้ง "การจัดการรายวิชา" และ "ประวัติการสอน" มีจำนวนตรงกัน
    const createdCourses = [];
    const createdSchedules = [];

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

    sendResponse(res, 200, true, courses, 'Courses retrieved', createPaginationObject(page, limit, total));
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
      teacherIncomeIndividual, teacherIncomeGroup, coursePrice
    } = req.body;

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

    // อัพเดต Schedule ที่เชื่อมกับ Course นี้
    const scheduleUpdate = {};
    if (scheduledDate !== undefined) scheduleUpdate.date                     = new Date(scheduledDate);
    if (startTime     !== undefined) scheduleUpdate.startTime                = startTime;
    if (endTime       !== undefined) scheduleUpdate.endTime                  = endTime;
    if (teacher       !== undefined) scheduleUpdate.teacher                  = teacher;
    if (teacherIncomeIndividual !== undefined) scheduleUpdate.teacherIncomeIndividual = Number(teacherIncomeIndividual);
    if (teacherIncomeGroup      !== undefined) scheduleUpdate.teacherIncomeGroup      = Number(teacherIncomeGroup);
    if (coursePrice             !== undefined) scheduleUpdate.coursePrice             = Number(coursePrice);

    // ── ถ้ามีการเปลี่ยน "วัน/เวลา/ครู" → reset teacherConfirmed
    //    เพราะครูคนใหม่ (หรือคนเดิมในเวลาใหม่) ต้องยืนยันใหม่ ──
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
      // อัปเดตเฉพาะ schedule ที่ยังไม่ completed/cancelled (กันแก้ของที่จบแล้ว)
      await Schedule.updateMany(
        { course: course._id, status: { $nin: ['cancelled', 'completed', 'awaiting_confirmation'] } },
        { $set: scheduleUpdate }
      );
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

    sendResponse(res, 200, true, course, 'แก้ไขนัดสอนสำเร็จ — ส่งอีเมลแจ้งเตือนแล้ว');
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
