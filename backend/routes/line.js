const express = require('express');
const LineConnection = require('../models/LineConnection');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse } = require('../utils/helpers');
const { verifyIdentity, verifyFriendship, validSignature, observeFriendship, lineUserId } = require('../services/lineService');
const { previewReminders } = require('../services/lineReminderService');

const router = express.Router();
const student = [authenticateToken, roleCheck(['student'])];
const staff = [authenticateToken, roleCheck(['admin', 'manager'])];

const handle = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.code === 11000) {
      return sendResponse(res, 409, false, null, 'บัญชี LINE หรือบัญชีนักเรียนนี้ผูกไว้แล้ว');
    }
    // Upstream request errors may contain LINE credentials in their config.
    console.error('[LINE]', error.code || error.name);
    sendResponse(res, 503, false, null, 'ระบบ LINE ใช้งานไม่ได้ชั่วคราว');
  }
};

function connectionStatus(link, userId) {
  return {
    linked: Boolean(link),
    matches: Boolean(link && link._id === userId),
    optedIn: link?.optedIn === true,
    friend: link?.friend === true
  };
}

router.get('/config', (req, res) => sendResponse(res, 200, true, {
  liffId: process.env.LINE_LIFF_ID || null
}, 'LINE configuration'));

router.post('/connection/status', student, handle(async (req, res) => {
  const [userId, linked, active] = await Promise.all([
    verifyIdentity(req.body.idToken),
    LineConnection.findOne({ student: req.user.id }).lean(),
    User.exists({ _id: req.user.id, role: 'student', isActive: true })
  ]);
  if (!userId || !active) return sendResponse(res, 403, false, null, 'ยืนยันบัญชี LINE หรือ KMS ไม่สำเร็จ');
  sendResponse(res, 200, true, connectionStatus(linked, userId), 'LINE connection');
}));

router.put('/connection', student, handle(async (req, res) => {
  const { idToken, accessToken, optedIn } = req.body;
  if (typeof optedIn !== 'boolean') return sendResponse(res, 400, false, null, 'กรุณาเลือกการรับแจ้งเตือน');
  const [userId, active, linked] = await Promise.all([
    verifyIdentity(idToken),
    User.exists({ _id: req.user.id, role: 'student', isActive: true }),
    LineConnection.findOne({ student: req.user.id }).lean()
  ]);
  if (!userId || !active) return sendResponse(res, 403, false, null, 'ยืนยันบัญชี LINE หรือ KMS ไม่สำเร็จ');
  if (linked && linked._id !== userId) {
    return sendResponse(res, 409, false, null, 'กรุณายกเลิกการผูกบัญชีเดิมก่อน');
  }
  if (!linked) {
    const observedAt = Date.now();
    const friend = await verifyFriendship(userId, accessToken);
    if (friend === null) return sendResponse(res, 403, false, null, 'ตรวจสอบการเป็นเพื่อนกับ LINE OA ไม่สำเร็จ');
    await observeFriendship(userId, friend, observedAt);
  }
  // _id prevents two students sharing one LINE account. The unique student index
  // also prevents one student from linking two LINE accounts concurrently.
  await LineConnection.init();
  const link = await LineConnection.findOneAndUpdate({
    _id: userId, $or: [{ student: { $exists: false } }, { student: req.user.id }]
  }, { $set: { student: req.user.id, optedIn } }, { new: true });
  if (!link) return sendResponse(res, 409, false, null, 'บัญชี LINE นี้ผูกไว้แล้ว');
  sendResponse(res, 200, true, connectionStatus(link, userId), 'LINE connection saved');
}));

router.delete('/connection', student, handle(async (req, res) => {
  await LineConnection.updateOne({ student: req.user.id },
    { $unset: { student: 1 }, $set: { optedIn: false } });
  sendResponse(res, 200, true, null, 'ยกเลิกการผูก LINE แล้ว');
}));

router.get('/reminders/preview', staff, handle(async (req, res) => {
  sendResponse(res, 200, true, await previewReminders(), 'LINE reminder preview');
}));

const webhook = handle(async (req, res) => {
  if (!validSignature(req.body, req.get('x-line-signature'))) {
    return sendResponse(res, 401, false, null, 'Invalid LINE signature');
  }
  let events;
  try {
    ({ events } = JSON.parse(req.body.toString('utf8')));
  } catch {
    return sendResponse(res, 400, false, null, 'Invalid LINE events');
  }
  if (!Array.isArray(events)) return sendResponse(res, 400, false, null, 'Invalid LINE events');
  for (const event of events) {
    if (['follow', 'unfollow'].includes(event.type) && event.source?.type === 'user'
      && lineUserId.test(event.source.userId) && Number.isSafeInteger(event.timestamp)) {
      await observeFriendship(event.source.userId, event.type === 'follow', event.timestamp);
    }
  }
  sendResponse(res, 200, true, null, 'LINE webhook processed');
});

module.exports = { router, webhook, rawWebhook: express.raw({ type: 'application/json', limit: '256kb' }) };
