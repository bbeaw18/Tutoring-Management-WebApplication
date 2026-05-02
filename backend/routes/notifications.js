const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const { sendResponse, getPaginationParams, createPaginationObject } = require('../utils/helpers');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { type, isRead } = req.query;

    let query = { recipient: req.user.id };

    if (type && ['payment', 'enrollment', 'schedule', 'course', 'general', 'video'].includes(type)) {
      query.type = type;
    }

    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    const total = await Notification.countDocuments(query);
    const notifications = await Notification.find(query)
      .populate('sender', 'firstName lastName nickname profileImage')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, notifications, 'Notifications retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get notifications error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    // ส่งทั้ง count และ unreadCount เพื่อ backward compat (frontend ใช้ res.data.count)
    sendResponse(res, 200, true, { count, unreadCount: count }, 'Unread count retrieved');
  } catch (error) {
    console.error('Get unread count error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ── Mark single notification as read ──
// รองรับทั้ง PUT และ POST (frontend NotificationService ใช้ POST)
const markAsReadHandler = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return sendResponse(res, 404, false, null, 'Notification not found');
    }

    if (notification.recipient.toString() !== req.user.id) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    notification.isRead = true;
    await notification.save();
    await notification.populate('sender', 'firstName lastName nickname profileImage');

    sendResponse(res, 200, true, notification, 'Notification marked as read');
  } catch (error) {
    console.error('Mark as read error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
};
router.put('/:id/read', authenticateToken, markAsReadHandler);
router.post('/:id/read', authenticateToken, markAsReadHandler);

// ── Mark all as read ──
const markAllAsReadHandler = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true }
    );

    sendResponse(res, 200, true, {
      modifiedCount: result.modifiedCount
    }, 'All notifications marked as read');
  } catch (error) {
    console.error('Mark all as read error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
};
router.put('/read-all', authenticateToken, markAllAsReadHandler);
router.post('/read-all', authenticateToken, markAllAsReadHandler);

// ── Delete notification ──
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return sendResponse(res, 404, false, null, 'Notification not found');
    }

    if (notification.recipient.toString() !== req.user.id) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    await Notification.findByIdAndDelete(req.params.id);
    sendResponse(res, 200, true, null, 'Notification deleted');
  } catch (error) {
    console.error('Delete notification error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
