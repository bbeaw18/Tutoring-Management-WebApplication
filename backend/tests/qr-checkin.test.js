// Run against a disposable replica set: TEST_MONGODB_URI=... node --test tests/qr-checkin.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { qrWindow } = require('../utils/qrWindow');

test('QR window uses Thai class end time, including overnight classes', () => {
  const normal = qrWindow({ date: '2026-11-20T00:00:00+07:00', startTime: '10:00', endTime: '12:00' });
  assert.equal(normal.opensAt.toISOString(), '2026-11-20T04:30:00.000Z');
  assert.equal(normal.closesAt.toISOString(), '2026-11-20T05:30:00.000Z');
  const overnight = qrWindow({ date: '2026-11-20T00:00:00+07:00', startTime: '23:00', endTime: '01:00' });
  assert.equal(overnight.opensAt.toISOString(), '2026-11-20T17:30:00.000Z');
  assert.equal(overnight.closesAt.toISOString(), '2026-11-20T18:30:00.000Z');
});

test('QR review/check-in API commits both records together and enforces time and role', {
  skip: !process.env.TEST_MONGODB_URI
}, async t => {
  process.env.JWT_SECRET = 'disposable-qr-checkin-test-secret';
  const mongoose = require('mongoose');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');
  const Course = require('../models/Course');
  const Schedule = require('../models/Schedule');
  const Attendance = require('../models/Attendance');
  const Review = require('../models/Review');
  const { computeEffectivePrice } = require('../utils/helpers');
  const { buildPaymentSummariesByScheduleId } = require('../utils/scheduleAggregation');
  await mongoose.connect(process.env.TEST_MONGODB_URI);
  t.after(() => mongoose.disconnect());
  const app = express();
  app.use(express.json());
  app.use('/attendance', require('../routes/attendance'));
  app.use('/schedules', require('../routes/schedules'));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ success: false, message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = await User.create(['teacher', 'student', 'student'].map((role, i) => ({
    role, firstName: role, lastName: 'QR test', email: `qr-${i}@example.test`, password: 'test-only-password'
  })));
  const [teacher, student, other] = users;
  const tokens = users.map(u => jwt.sign({ id: String(u._id), role: u.role }, process.env.JWT_SECRET, { noTimestamp: true }));
  const course = await Course.create({ name: 'QR test', subject: 'Math', teacher: teacher._id, createdBy: teacher._id });
  async function lesson(extra = {}) {
    return Schedule.create({ course: course._id, teacher: teacher._id, students: [student._id, other._id],
      date: '2026-11-20T00:00:00+07:00', startTime: '10:00', endTime: '12:00',
      status: 'confirmed', teacherConfirmed: true, qrActive: true, qrToken: 'test-qr',
      qrExpiresAt: '2026-11-20T12:30:00+07:00', coursePrice: 300, totalDurationMinutes: 120, ...extra });
  }
  async function post(path, body, who = 1) {
    const res = await fetch(base + path, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}`
    }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  }
  async function get(path, who = 1) {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${tokens[who]}` } });
    return { status: res.status, body: await res.json() };
  }
  const at = time => t.mock.timers.setTime(new Date(`2026-11-20T${time}+07:00`).getTime());
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-20T11:29:59.999+07:00').getTime() });
  const s = await lesson();
  const payload = { scheduleId: String(s._id), token: 'test-qr', rating: 5, comment: '  เข้าใจง่าย  ' };
  assert.equal((await post(`/schedules/${s._id}/generate-qr`, {}, 0)).status, 400);
  assert.equal((await post('/attendance/scan/preview', payload)).status, 400);
  at('11:30:00.000');
  const generated = await post(`/schedules/${s._id}/generate-qr`, {}, 0);
  assert.equal(generated.status, 200);
  payload.token = generated.body.data.qrToken;
  const preview = await post('/attendance/scan/preview', payload);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.data.checkedIn, false);
  assert.equal(await Attendance.countDocuments(), 0);
  assert.equal(await Review.countDocuments(), 0);
  assert.equal((await post('/attendance/scan', { ...payload, rating: 0 })).status, 400);
  assert.equal((await post('/attendance/scan', { ...payload, comment: 'x'.repeat(501) })).status, 400);
  assert.equal((await post('/attendance/scan', payload, 0)).status, 403);
  assert.equal((await post('/attendance/scan', { ...payload, token: 'old-qr' })).status, 400);
  assert.equal(await Attendance.countDocuments(), 0);
  const submissions = await Promise.all(Array.from({ length: 4 }, () => post('/attendance/scan', payload)));
  assert.deepEqual(submissions.map(r => r.status), [200, 200, 200, 200]);
  assert.equal(await Attendance.countDocuments(), 1);
  assert.equal(await Review.countDocuments(), 1);
  assert.equal((await Review.findOne()).comment, 'เข้าใจง่าย');
  assert.equal((await Schedule.findById(s._id)).status, 'confirmed');
  const studentHistory = await get('/attendance/my');
  assert.equal(studentHistory.status, 200);
  assert.ok(studentHistory.body.data.some(row => row.schedule._id === String(s._id)));
  const teacherList = await get(`/attendance/schedule/${s._id}`, 0);
  assert.equal(teacherList.status, 200);
  assert.equal(teacherList.body.data.length, 1);
  const afterSubmit = await post('/attendance/scan/preview', payload);
  assert.equal(afterSubmit.body.data.checkedIn, true);
  assert.equal(afterSubmit.body.data.submitted, true);
  assert.equal((await post('/attendance/scan', { ...payload, rating: 1 })).status, 200);
  assert.equal((await Review.findOne()).rating, 5);
  assert.equal((await post('/attendance/scan', payload, 2)).status, 200);
  assert.equal(computeEffectivePrice(s), 600);
  const summary = (await buildPaymentSummariesByScheduleId([s])).get(String(s._id));
  assert.equal(summary.effectivePrice, 600);
  assert.equal(summary.total, 1200);
  const concurrentClass = await lesson();
  const concurrentResults = await Promise.all([1, 2].map(who => post('/attendance/scan', {
    ...payload, scheduleId: String(concurrentClass._id), token: 'test-qr'
  }, who)));
  assert.deepEqual(concurrentResults.map(r => r.status), [200, 200]);
  assert.equal((await get(`/attendance/schedule/${concurrentClass._id}`, 0)).body.data.length, 2);
  const closingClass = await lesson();
  const closingPayload = { ...payload, scheduleId: String(closingClass._id), token: 'test-qr' };
  assert.equal((await post('/attendance/scan/preview', closingPayload)).status, 200);
  await Schedule.updateOne({ _id: closingClass._id }, { qrActive: false, status: 'awaiting_confirmation' });
  assert.equal((await post('/attendance/scan', closingPayload)).status, 400);
  assert.equal(await Attendance.countDocuments({ schedule: closingClass._id }), 0);
  assert.equal(await Review.countDocuments({ schedule: closingClass._id }), 0);
  const legacy = await lesson();
  const originalCheckIn = await Attendance.create({ schedule: legacy._id, student: student._id });
  assert.equal((await post('/attendance/scan', { ...payload, scheduleId: String(legacy._id), token: 'test-qr' })).status, 200);
  assert.equal(await Attendance.countDocuments({ schedule: legacy._id }), 1);
  assert.equal(await Review.countDocuments({ schedule: legacy._id }), 1);
  assert.equal((await Attendance.findOne({ schedule: legacy._id })).scannedAt.getTime(), originalCheckIn.scannedAt.getTime());
  const expired = await lesson({ qrExpiresAt: '2026-11-20T11:29:00+07:00' });
  assert.equal((await post('/attendance/scan', { ...payload, scheduleId: String(expired._id), token: 'test-qr' })).status, 400);
  const rollback = await lesson();
  const original = Review.findOneAndUpdate;
  try {
    Review.findOneAndUpdate = async () => { throw new Error('Injected review write failure'); };
    assert.equal((await post('/attendance/scan', { ...payload, scheduleId: String(rollback._id), token: 'test-qr' })).status, 500);
  } finally { Review.findOneAndUpdate = original; }
  assert.equal(await Attendance.countDocuments({ schedule: rollback._id }), 0);
  assert.equal(await Review.countDocuments({ schedule: rollback._id }), 0);
  assert.equal((await post('/attendance/scan', { ...payload, scheduleId: String(rollback._id), token: 'test-qr' })).status, 200);
  const denied = await lesson({ students: [other._id] });
  assert.equal((await post('/attendance/scan', { ...payload, scheduleId: String(denied._id), token: 'test-qr' })).status, 403);
  await Schedule.updateOne({ _id: rollback._id }, { qrActive: false });
  assert.equal((await post('/attendance/scan', { ...payload, scheduleId: String(rollback._id), token: 'test-qr' })).status, 400);
  at('12:30:00.000');
  assert.equal((await post('/attendance/scan/preview', payload)).status, 200);
  assert.equal((await post(`/schedules/${s._id}/generate-qr`, {}, 0)).status, 200);
  at('12:30:00.001');
  assert.equal((await post('/attendance/scan/preview', { ...payload, token: (await Schedule.findById(s._id)).qrToken })).status, 400);
  assert.equal((await post('/attendance/scan', { ...payload, token: (await Schedule.findById(s._id)).qrToken })).status, 400);
  assert.equal((await post(`/schedules/${s._id}/generate-qr`, {}, 0)).status, 400);
});
