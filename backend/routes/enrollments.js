const express = require('express');
const router = express.Router();
const Enrollment = require('../models/Enrollment');
const User = require('../models/User');
const Course = require('../models/Course');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject } = require('../utils/helpers');

router.post('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { student, course } = req.body;

    if (!student || !course) {
      return sendResponse(res, 400, false, null, 'Student and course required');
    }

    const studentExists = await User.findById(student);
    if (!studentExists || studentExists.role !== 'student') {
      return sendResponse(res, 400, false, null, 'Invalid student');
    }

    const courseExists = await Course.findById(course);
    if (!courseExists) {
      return sendResponse(res, 400, false, null, 'Course not found');
    }

    const existingEnrollment = await Enrollment.findOne({ student, course });
    if (existingEnrollment) {
      return sendResponse(res, 400, false, null, 'Student already enrolled in this course');
    }

    const enrollment = new Enrollment({
      student,
      course,
      enrolledBy: req.user.id,
      status: 'pending'
    });

    await enrollment.save();
    await enrollment.populate('student', 'firstName lastName email');
    await enrollment.populate('course', 'name subject');

    const notification = new Notification({
      recipient: student,
      sender: req.user.id,
      type: 'enrollment',
      title: 'New Course Enrollment',
      message: `You have been enrolled in ${courseExists.name}`,
      relatedId: course
    });
    await notification.save();

    sendResponse(res, 201, true, enrollment, 'Student enrolled');
  } catch (error) {
    console.error('Create enrollment error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { student, course, status } = req.query;

    let query = {};

    if (req.user.role === 'student') {
      // Students can only see their own enrollments — ignore any ?student= param
      query.student = req.user.id;
    } else if (['admin', 'manager'].includes(req.user.role)) {
      // Admin/manager can filter by student
      if (student) query.student = student;
    }

    if (course) query.course = course;
    if (status) query.status = status;

    const total = await Enrollment.countDocuments(query);
    const enrollments = await Enrollment.find(query)
      .populate('student', 'firstName lastName email')
      .populate('course', 'name subject')
      .populate('enrolledBy', 'firstName lastName')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, enrollments, 'Enrollments retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get enrollments error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/student/:studentId', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);

    if (req.user.id !== req.params.studentId && !['admin', 'manager'].includes(req.user.role)) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    const total = await Enrollment.countDocuments({ student: req.params.studentId });
    const enrollments = await Enrollment.find({ student: req.params.studentId })
      .populate('student', 'firstName lastName email')
      .populate('course', 'name subject price')
      .populate('enrolledBy', 'firstName lastName')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, enrollments, 'Student enrollments retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get student enrollments error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.put('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { status } = req.body;

    if (!status || !['pending', 'active', 'completed', 'cancelled'].includes(status)) {
      return sendResponse(res, 400, false, null, 'Invalid status');
    }

    const enrollment = await Enrollment.findByIdAndUpdate(
      req.params.id,
      { status, completedAt: status === 'completed' ? new Date() : null },
      { new: true, runValidators: true }
    ).populate('student', 'firstName lastName email')
      .populate('course', 'name subject');

    if (!enrollment) {
      return sendResponse(res, 404, false, null, 'Enrollment not found');
    }

    const notification = new Notification({
      recipient: enrollment.student._id,
      sender: req.user.id,
      type: 'enrollment',
      title: 'Enrollment Status Updated',
      message: `Your enrollment status for ${enrollment.course.name} is now ${status}`,
      relatedId: enrollment.course._id
    });
    await notification.save();

    sendResponse(res, 200, true, enrollment, 'Enrollment updated');
  } catch (error) {
    console.error('Update enrollment error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.delete('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const enrollment = await Enrollment.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    ).populate('student', 'firstName lastName email');

    if (!enrollment) {
      return sendResponse(res, 404, false, null, 'Enrollment not found');
    }

    sendResponse(res, 200, true, enrollment, 'Enrollment cancelled');
  } catch (error) {
    console.error('Delete enrollment error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
