const axios = require('axios');
const { randomUUID } = require('crypto');
const LineConnection = require('../models/LineConnection');
const User = require('../models/User');
const { LineReminderRun, LineReminderDelivery } = require('../models/LineReminder');
const { getTuition, thaiMonth } = require('./tuitionService');

const leaseMs = 2 * 60_000;
const retryDelayMs = 5 * 60_000;
const retryLimitMs = 23 * 3600_000;
const eligible = { optedIn: true, friend: true, student: { $exists: true } };
const bkk = now => new Date(now.getTime() + 7 * 3600000);

function reminderWindow(now) {
  const local = bkk(now);
  return local.getUTCDate() > 3 || (local.getUTCDate() === 3 && local.getUTCHours() >= 9);
}

async function eligibleMonths(student, round) {
  const bills = await getTuition(student);
  return [...new Set(bills.map(row => row.month).filter(month => month < round))].sort();
}

async function previewReminders(now = new Date()) {
  const round = thaiMonth(now);
  const [links, run, sent] = await Promise.all([
    LineConnection.find(eligible).populate('student', 'firstName lastName nickname role isActive').lean(),
    LineReminderRun.findById(round).lean(),
    LineReminderDelivery.find({ round }).select('student status attempts reason').lean()
  ]);
  const deliveries = new Map(sent.map(entry => [String(entry.student), entry]));
  const recipients = [];
  for (const { student } of links) {
    if (student?.role !== 'student' || !student.isActive) continue;
    const months = await eligibleMonths(student._id, round);
    if (months.length) {
      recipients.push({
        studentId: student._id,
        name: student.nickname || `${student.firstName} ${student.lastName}`,
        months,
        status: deliveries.get(String(student._id))?.status || 'ready'
      });
    }
  }
  return {
    round, due: reminderWindow(now), enabled: process.env.LINE_REMINDERS_ENABLED === 'true',
    quotaExceededAt: run?.quotaExceededAt || null, recipients, deliveries: sent
  };
}

async function push({ recipient, retryKey, uri }) {
  const response = await axios.post('https://api.line.me/v2/bot/message/push', {
    to: recipient,
    messages: [{
      type: 'template',
      altText: 'มีค่าเรียนค้างชำระ กรุณาเปิด KMS เพื่อตรวจสอบ',
      template: {
        type: 'buttons',
        text: 'มีค่าเรียนค้างชำระ กรุณาตรวจสอบยอดและ QR ใน KMS',
        actions: [{ type: 'uri', label: 'ดูยอดและ QR ชำระเงิน', uri }]
      }
    }]
  }, {
    timeout: 8000,
    headers: {
      Authorization: `Bearer ${process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN}`,
      'X-Line-Retry-Key': retryKey
    },
    validateStatus: () => true
  });
  return response;
}

async function runLineReminders(now = new Date()) {
  if (process.env.LINE_REMINDERS_ENABLED !== 'true' || !reminderWindow(now)) return;
  if (!process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || !process.env.LINE_TUITION_URL?.startsWith('https://')) {
    throw new Error('LINE reminder configuration is incomplete');
  }
  const round = thaiMonth(now);
  const owner = randomUUID();
  try {
    await LineReminderRun.findOneAndUpdate({
      _id: round, quotaExceededAt: { $exists: false },
      $or: [{ lockedUntil: { $lte: new Date() } }, { lockedUntil: { $exists: false } }]
    }, { $set: { owner, lockedUntil: new Date(Date.now() + leaseMs) } }, { upsert: true });
  } catch (error) {
    if (error.code === 11000) return;
    throw error;
  }
  const lease = { _id: round, owner };
  try {
    const [linked, retrying] = await Promise.all([
      LineConnection.distinct('student', eligible),
      LineReminderDelivery.distinct('student', { round, status: 'retry' })
    ]);
    const students = new Set([...linked, ...retrying].map(String));
    for (const student of students) {
      const id = `${round}:${student}`;
      const entry = await LineReminderDelivery.findById(id).lean();
      if (entry && (entry.status !== 'retry' || entry.nextAttemptAt > new Date())) continue;
      const [current, active, months] = await Promise.all([
        LineConnection.findOne({ ...eligible, student }).select('_id').lean(),
        User.exists({ _id: student, role: 'student', isActive: true }),
        eligibleMonths(student, round)
      ]);
      const renewed = await LineReminderRun.updateOne({ ...lease, lockedUntil: { $gt: new Date() } },
        { $set: { lockedUntil: new Date(Date.now() + leaseMs) } });
      if (!renewed.matchedCount || process.env.LINE_REMINDERS_ENABLED !== 'true') return;
      if (!current || !active || !months.length || (entry && entry.recipient !== current._id)) {
        if (entry) {
          await LineReminderDelivery.updateOne({ _id: id },
            { $set: { status: 'skipped', reason: 'eligibility_changed' } });
        }
        continue;
      }
      if (entry && Date.now() - entry.firstAttemptAt.getTime() >= retryLimitMs) {
        await LineReminderDelivery.updateOne({ _id: id },
          { $set: { status: 'failed', reason: 'retry_window_elapsed' } });
        continue;
      }
      const delivery = await LineReminderDelivery.findOneAndUpdate({ _id: id }, {
        $setOnInsert: { round, student, recipient: current._id, retryKey: randomUUID(), uri: process.env.LINE_TUITION_URL,
          firstAttemptAt: new Date(), status: 'retry' },
        $set: { nextAttemptAt: new Date(Date.now() + retryDelayMs) },
        $inc: { attempts: 1 }
      }, { new: true, upsert: true, setDefaultsOnInsert: false });
      let response;
      try {
        response = await push(delivery);
      } catch {
        await LineReminderDelivery.updateOne({ _id: id }, { $set: { reason: 'network_error' } });
        continue;
      }
      if (response.status === 429 && /monthly limit/i.test(response.data?.message || '')) {
        await LineReminderRun.updateOne(lease, { $set: { quotaExceededAt: new Date() } });
        await LineReminderDelivery.updateOne({ _id: id },
          { $set: { status: 'failed', reason: 'quota_exceeded' } });
        return;
      }
      const accepted = response.status === 200 ||
        (response.status === 409 && response.headers['x-line-accepted-request-id']);
      const retry = response.status >= 500 || response.status === 429;
      await LineReminderDelivery.updateOne({ _id: id }, { $set: {
        status: accepted ? 'accepted' : (retry ? 'retry' : 'failed'),
        reason: accepted ? 'line_accepted' : `line_http_${response.status}`
      } });
    }
  } finally {
    await LineReminderRun.updateOne(lease, { $unset: { owner: 1, lockedUntil: 1 } });
  }
}

module.exports = { runLineReminders, previewReminders };
