const express = require('express');
const router = express.Router();
const Video = require('../models/Video');
const User = require('../models/User');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject } = require('../utils/helpers');

// Whitelist of host suffixes allowed for zoomRecordingUrl. Anything outside
// these hosts is rejected because the URL is rendered inside an <iframe> on
// the student player — a non-https URL (or javascript:/data:) would XSS via
// the frontend's DomSanitizer bypass.
const ALLOWED_VIDEO_HOST_SUFFIXES = [
  'zoom.us',
  'zoomgov.com',
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com',
  'player.vimeo.com'
];

function isAllowedVideoUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_VIDEO_HOST_SUFFIXES.some(suffix =>
    host === suffix || host.endsWith('.' + suffix)
  );
}

router.post('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { title, description, zoomRecordingUrl, zoomMeetingId, course, duration, recordedAt } = req.body;

    if (!title || !description || !zoomRecordingUrl || !course || !recordedAt) {
      return sendResponse(res, 400, false, null, 'Missing required fields');
    }

    if (!isAllowedVideoUrl(zoomRecordingUrl)) {
      return sendResponse(res, 400, false, null,
        'zoomRecordingUrl ต้องเป็น https URL จาก host ที่อนุญาตเท่านั้น (zoom.us, youtube.com, vimeo.com)');
    }

    const courseExists = await Course.findById(course);
    if (!courseExists) {
      return sendResponse(res, 400, false, null, 'Course not found');
    }

    const video = new Video({
      title,
      description,
      zoomRecordingUrl,
      zoomMeetingId: zoomMeetingId || null,
      course,
      uploadedBy: req.user.id,
      duration: duration || 0,
      recordedAt: new Date(recordedAt),
      allowedStudents: [],
      isActive: true
    });

    await video.save();
    await video.populate('uploadedBy', 'firstName lastName nickname email');
    await video.populate('course', 'name');

    const enrolledStudents = await Enrollment.find({ course, status: 'active' }).select('student');
    const studentIds = enrolledStudents.map(e => e.student);

    for (const studentId of studentIds) {
      const notification = new Notification({
        recipient: studentId,
        sender: req.user.id,
        type: 'video',
        title: 'New Video Available',
        message: `New video "${title}" is now available for ${courseExists.name}`,
        relatedId: video._id
      });
      await notification.save();
    }

    sendResponse(res, 201, true, video, 'Video uploaded');
  } catch (error) {
    console.error('Create video error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { course, search } = req.query;

    let query = { isActive: true };

    if (req.user.role === 'student') {
      query.$or = [
        { allowedStudents: { $in: [req.user.id] } },
        { allowedStudents: { $size: 0 } }
      ];
    }

    if (course) query.course = course;
    if (search) query.title = { $regex: search, $options: 'i' };

    const total = await Video.countDocuments(query);
    const videos = await Video.find(query)
      .populate('uploadedBy', 'firstName lastName nickname email')
      .populate('course', 'name subject')
      .limit(limit)
      .skip(skip)
      .sort({ recordedAt: -1 });

    sendResponse(res, 200, true, videos, 'Videos retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get videos error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id)
      .populate('uploadedBy', 'firstName lastName nickname email')
      .populate('course', 'name subject teacher')
      .populate('allowedStudents', 'firstName lastName nickname email');

    if (!video) {
      return sendResponse(res, 404, false, null, 'Video not found');
    }

    if (req.user.role === 'student' &&
        video.allowedStudents.length > 0 &&
        !video.allowedStudents.some(s => s._id.toString() === req.user.id)) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    sendResponse(res, 200, true, video, 'Video retrieved');
  } catch (error) {
    console.error('Get video error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.put('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { title, description, duration, isActive } = req.body;

    const video = await Video.findById(req.params.id);
    if (!video) {
      return sendResponse(res, 404, false, null, 'Video not found');
    }

    if (title) video.title = title;
    if (description) video.description = description;
    if (duration) video.duration = duration;
    if (isActive !== undefined) video.isActive = isActive;

    await video.save();
    await video.populate('uploadedBy', 'firstName lastName nickname email');

    sendResponse(res, 200, true, video, 'Video updated');
  } catch (error) {
    console.error('Update video error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.put('/:id/grant-access', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return sendResponse(res, 400, false, null, 'Student IDs array required');
    }

    const video = await Video.findById(req.params.id);
    if (!video) {
      return sendResponse(res, 404, false, null, 'Video not found');
    }

    for (const studentId of studentIds) {
      if (!video.allowedStudents.includes(studentId)) {
        video.allowedStudents.push(studentId);
      }

      const notification = new Notification({
        recipient: studentId,
        sender: req.user.id,
        type: 'video',
        title: 'Video Access Granted',
        message: `You now have access to video "${video.title}"`,
        relatedId: video._id
      });
      await notification.save();
    }

    await video.save();
    await video.populate('allowedStudents', 'firstName lastName nickname email');

    sendResponse(res, 200, true, video, 'Access granted');
  } catch (error) {
    console.error('Grant access error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.put('/:id/revoke-access', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return sendResponse(res, 400, false, null, 'Student IDs array required');
    }

    const video = await Video.findById(req.params.id);
    if (!video) {
      return sendResponse(res, 404, false, null, 'Video not found');
    }

    video.allowedStudents = video.allowedStudents.filter(
      id => !studentIds.includes(id.toString())
    );

    await video.save();
    await video.populate('allowedStudents', 'firstName lastName nickname email');

    sendResponse(res, 200, true, video, 'Access revoked');
  } catch (error) {
    console.error('Revoke access error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.delete('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!video) {
      return sendResponse(res, 404, false, null, 'Video not found');
    }

    sendResponse(res, 200, true, video, 'Video deactivated');
  } catch (error) {
    console.error('Delete video error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
