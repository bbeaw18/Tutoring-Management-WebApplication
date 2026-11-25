// Use a disposable MongoDB replica set. The test selects a fresh database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('crypto');
const { resolve } = require('path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

function parseTlv(text) {
  const tags = {};
  for (let i = 0; i < text.length;) {
    const tag = text.slice(i, i + 2);
    const length = Number(text.slice(i + 2, i + 4));
    tags[tag] = text.slice(i + 4, i + 4 + length);
    i += 4 + length;
  }
  return tags;
}

function readQr(dataURL) {
  const png = PNG.sync.read(Buffer.from(dataURL.split(',')[1], 'base64'));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(result, 'PNG must be readable by an independent QR decoder');
  return parseTlv(result.data);
}

test('LINE tuition HTTP flow, MongoDB transactions and reminder worker', {
  skip: !process.env.TEST_MONGODB_URI
}, async t => {
  Object.assign(process.env, {
    JWT_SECRET: 'test-only-line-jwt',
    LINE_LOGIN_CHANNEL_ID: '40123',
    LINE_MESSAGING_CHANNEL_SECRET: 'test-only-line-webhook',
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'test-only-line-bot',
    LINE_TUITION_URL: 'https://miniapp.line.me/test',
    LINE_LIFF_ID: 'test-liff',
    LINE_REMINDERS_ENABLED: 'false',
    PROMPTPAY_ID: '0800000000',
    BANK_NAME: 'Test bank',
    BANK_ACCOUNT_NUMBER: '000-0-00000-0',
    BANK_ACCOUNT_NAME: 'Test account',
    KBANK_WEBHOOK_SECRET: 'test-kbank-signature'
  });
  const mongoose = require('mongoose');
  const axios = require('axios');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const speakeasy = require('speakeasy');
  const { TERMS_VERSION } = require('../constants/terms');
  const User = require('../models/User');
  const Course = require('../models/Course');
  const Schedule = require('../models/Schedule');
  const Attendance = require('../models/Attendance');
  const Payment = require('../models/Payment');
  const PaymentSession = require('../models/PaymentSession');
  const TuitionQuote = require('../models/TuitionQuote');
  const LineConnection = require('../models/LineConnection');
  const { LineReminderDelivery } = require('../models/LineReminder');
  const line = require('../routes/line');
  const { runLineReminders, previewReminders } = require('../services/lineReminderService');
  const { runPaymentReminderJob } = require('../services/paymentReminderService');
  const emailService = require('../services/emailService');

  await mongoose.connect(process.env.TEST_MONGODB_URI, { dbName: `lineqa_${randomUUID().replaceAll('-', '')}` });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  await Promise.all([User.init(), Schedule.init(), Attendance.init(), Payment.init(),
    TuitionQuote.init(), LineConnection.init(), LineReminderDelivery.init()]);

  const app = express();
  app.post('/line/webhook', line.rawWebhook, line.webhook);
  app.use('/payments/kbank/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.use('/line', line.router);
  app.use('/payments', require('../routes/payments'));
  app.use('/auth', require('../routes/auth'));
  app.use('/attendance', require('../routes/attendance'));
  app.use('/users', require('../routes/users'));
  app.use('/expenses', require('../routes/expenses'));
  if (process.env.LINE_TEST_CHROME) {
    const assets = resolve(__dirname, '../../frontend/dist/kms-webapp-frontend');
    app.use(express.static(assets));
    app.get('*', (req, res) => res.sendFile(resolve(assets, 'index.html')));
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const password = 'test-password-only';
  const users = await User.create(['student', 'student', 'manager', 'teacher', 'student', 'student', 'student'].map((role, i) => ({
    role, firstName: `Test ${i}`, lastName: 'Tuition', email: `line-${i}@example.test`, password,
    acceptedTerms: role === 'manager' ? {
      student: { version: TERMS_VERSION, at: new Date() }, teacher: { version: TERMS_VERSION, at: new Date() }
    } : undefined
  })));
  const [student, other, , teacher, workerStudent, workerOther, webOnlyStudent] = users;
  const tokens = users.map(user => jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET));
  const course = await Course.create({ name: 'Math test', subject: 'Math', teacher: teacher._id, createdBy: teacher._id });

  async function lesson({ students = [student._id], checked = students, ...extra } = {}) {
    const schedule = await Schedule.create({ course: course._id, teacher: teacher._id, students,
      date: '2026-11-10T00:00:00+07:00', startTime: '10:00', endTime: '12:00',
      status: 'completed', coursePrice: 300, ...extra });
    await Attendance.insertMany(checked.map(id => ({ schedule: schedule._id, student: id })));
    return String(schedule._id);
  }

  async function request(path, { who = 0, method = 'GET', body, token = tokens[who] } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    return { status: response.status, data: payload.data, message: payload.message };
  }

  const bill = who => request('/payments/unpaid', { who });
  const quote = (body, who = 0) => request('/payments/generate-promptpay-qr', { body, who, method: 'POST' });
  const claim = (body, who = 0) => request('/payments/claim-transfer', { body, who, method: 'POST' });
  const ids = Array.from({ length: 6 }, (_, index) => `U${String(index).repeat(32)}`);
  const pushes = [];
  const accepted = new Set();
  let pushMode = 'normal';

  const originalAdapter = axios.defaults.adapter;
  t.after(() => { axios.defaults.adapter = originalAdapter; });
  axios.defaults.adapter = async config => {
    let data;
    let status = 200;
    let headers = {};
    if (config.url.endsWith('/message/push')) {
      const body = JSON.parse(config.data);
      const key = config.headers.get('X-Line-Retry-Key');
      pushes.push({ to: body.to, key, body });
      assert.match(key, /^[a-f0-9-]{36}$/);
      if (pushMode === 'quota') {
        status = 429;
        data = { message: 'You have reached your monthly limit.' };
      } else if (accepted.has(key)) {
        status = 409;
        headers = { 'x-line-accepted-request-id': 'mock-original' };
      } else {
        accepted.add(key);
        if (pushMode === 'timeout') throw Object.assign(new Error('Mock accepted, client timeout'), { code: 'ECONNABORTED' });
      }
    } else if (config.method === 'post' && config.url.endsWith('/verify')) {
      const value = new URLSearchParams(config.data).get('id_token');
      assert.equal(new URLSearchParams(config.data).get('client_id'), '40123');
      const index = Number(value.replace(/\D/g, ''));
      data = { sub: ids[index], iss: 'https://access.line.me',
        aud: value.startsWith('wrong') ? '40124' : '40123',
        exp: Date.now() / 1000 + (value.startsWith('expired') ? -60 : 3600) };
    } else if (config.url.endsWith('/verify')) {
      data = { client_id: '40123', expires_in: 3600 };
    } else if (config.url.endsWith('/profile')) {
      data = { userId: ids[Number(config.headers.get('Authorization').at(-1))] };
    } else if (config.url.endsWith('/status')) {
      data = { friendFlag: true };
    } else {
      assert.fail(`Unexpected outbound call to ${config.url}`);
    }
    return { status, statusText: String(status), headers, data, config };
  };

  const link = (who, id, extra = {}) => request('/line/connection', {
    who, method: 'PUT', body: { idToken: `id-${id}`, accessToken: `access-${id}`, optedIn: true, ...extra }
  });
  const checkLink = (who, id, token) => request('/line/connection/status', {
    who, token, method: 'POST', body: { idToken: `id-${id}` }
  });
  const webhook = async (type, id, timestamp, signed = true) => {
    const body = JSON.stringify({ events: [{ type, timestamp, source: { type: 'user', userId: ids[id] } }] });
    const signature = createHmac('sha256', process.env.LINE_MESSAGING_CHANNEL_SECRET).update(body).digest('base64');
    return fetch(base + '/line/webhook', { method: 'POST', body, headers: {
      'Content-Type': 'application/json', 'X-Line-Signature': signed ? signature : 'invalid'
    } });
  };

  await t.test('KMS TOTP, channel/expiry, duplicate links, forwarded link and signed webhook', async () => {
    const secret = speakeasy.generateSecret().base32;
    await User.updateOne({ _id: student._id }, { totpSecret: secret, totpEnabled: true });
    const login = await request('/auth/login', { method: 'POST', body: { email: student.email, password }, token: '' });
    assert.equal(login.status, 200);
    assert.equal(login.data.requireOtp, true);
    assert.equal(login.data.token, undefined);
    assert.equal((await checkLink(0, 0, '')).status, 401);
    const verified = await request('/auth/verify-totp', { method: 'POST', token: '', body: {
      userId: login.data.userId, token: speakeasy.totp({ secret, encoding: 'base32' })
    } });
    assert.equal(verified.status, 200, verified.message);
    tokens[0] = verified.data.token;
    assert.equal((await link(0, 0, { idToken: 'expired-0' })).status, 403);
    assert.equal((await link(0, 0, { idToken: 'wrong-0' })).status, 403);
    assert.equal((await link(0, 0, { accessToken: 'access-1' })).status, 403);
    const competing = await Promise.all([link(0, 0), link(1, 0)]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    const winner = competing.findIndex(result => result.status === 200);
    const loser = 1 - winner;
    assert.equal((await checkLink(winner, 0)).data.matches, true);
    assert.equal((await checkLink(loser, 0)).data.matches, false);
    assert.equal((await request('/line/connection', { who: winner, method: 'DELETE' })).status, 200);
    assert.equal((await checkLink(winner, 0)).data.linked, false);
    const forSameStudent = await Promise.all([link(0, 0), link(0, 1)]);
    assert.deepEqual(forSameStudent.map(result => result.status).sort(), [200, 409]);
    const id = forSameStudent.findIndex(result => result.status === 200);
    const time = Date.now() + 1000;
    assert.equal((await webhook('unfollow', id, time, false)).status, 401);
    assert.equal((await checkLink(0, id)).data.friend, true);
    assert.equal((await webhook('unfollow', id, time)).status, 200);
    assert.equal((await webhook('unfollow', id, time)).status, 200);
    assert.equal((await webhook('follow', id, time - 1)).status, 200);
    assert.equal((await checkLink(0, id)).data.friend, false);
    assert.equal((await webhook('follow', id, time + 1)).status, 200);
    assert.equal((await checkLink(0, id)).data.friend, true);
    assert.equal((await link(0, id, { optedIn: false })).data.optedIn, false);
    assert.equal((await request('/line/reminders/preview', { who: 0 })).status, 403);
    assert.equal((await request('/line/reminders/preview', { who: 2 })).status, 200);
  });

  await t.test('group tuition is 600 THB per student, including decoded amount and payee', async () => {
    const scheduleId = await lesson({ students: [student._id, other._id] });
    for (const who of [0, 1]) {
      const data = (await bill(who)).data;
      assert.equal(data.unpaid.find(row => row.scheduleId === scheduleId).amount, 600);
      const response = await quote({ scheduleId, amount: 1 }, who);
      assert.equal(response.status, 200, response.message);
      const tags = readQr(response.data.qrDataURL);
      assert.equal(tags['54'], '600.00');
      assert.equal(tags['53'], '764');
      assert.equal(parseTlv(tags['29'])['01'], '0066800000000');
      t.diagnostic(`student ${who}: bill 600, QR tag 54=${tags['54']}, test PromptPay payee matched`);
    }
    assert.equal((await bill(3)).status, 403);
    const privateId = await lesson();
    assert.equal((await quote({ scheduleId: privateId }, 1)).status, 409);
    const ownedQuote = (await quote({ scheduleId: privateId })).data;
    assert.equal((await claim({ quoteId: ownedQuote.quoteId }, 1)).status, 404);
    const promptpay = process.env.PROMPTPAY_ID;
    delete process.env.PROMPTPAY_ID;
    try {
      const web = await quote({ scheduleId: privateId, allowBankTransfer: true });
      assert.equal(web.status, 200);
      assert.equal(web.data.qrDataURL, null);
      assert.equal(web.data.amount, 600);
      assert.equal((await request('/payments/bank-info')).data.accountName, 'Test account');
    } finally {
      process.env.PROMPTPAY_ID = promptpay;
    }
  });

  await t.test('450 THB QR, current 300, one pending on concurrent submit, then manager confirms', async () => {
    const scheduleId = await lesson({ endTime: '11:30', date: '2026-08-03T00:00:00+07:00' });
    const old = (await quote({ scheduleId })).data;
    assert.equal(readQr(old.qrDataURL)['54'], '450.00');
    await Schedule.updateOne({ _id: scheduleId }, { totalDurationMinutes: 60, endTime: '11:00' });
    const resumed = (await quote({ scheduleId, resume: true })).data;
    assert.equal(resumed.quoteId, old.quoteId);
    assert.equal(resumed.stale, true);
    assert.equal(resumed.qrDataURL, null);
    assert.equal(resumed.currentAmount, 300);
    assert.equal(readQr((await quote({ scheduleId })).data.qrDataURL)['54'], '300.00');
    const submissions = await Promise.all([0, 1].map(() => claim({ quoteId: old.quoteId, amount: 1 })));
    assert.deepEqual(submissions.map(result => result.status).sort(), [200, 201]);
    assert.deepEqual(submissions[0].data.paymentIds, submissions[1].data.paymentIds);
    assert.equal(await Payment.countDocuments({ student: student._id, schedule: scheduleId }), 1);
    const paymentId = submissions[0].data.paymentIds[0];
    const row = (await request('/payments/pending-verification', { who: 2 })).data.find(p => p._id === paymentId);
    assert.equal(row.amount, 450);
    assert.equal(row.currentAmount, 300);
    assert.equal(row.amount - row.currentAmount, 150);
    assert.equal(row.status, 'pending');
    assert.ok(!(await bill(0)).data.unpaid.some(item => item.scheduleId === scheduleId));
    const id = (await LineConnection.findOne({ student: student._id })).id;
    await link(0, ids.indexOf(id));
    const preview = await previewReminders(new Date('2026-09-03T09:00:00+07:00'));
    assert.equal(preview.recipients.some(r => String(r.studentId) === String(student._id)), false);
    assert.equal((await request(`/payments/${paymentId}/confirm`, { method: 'PUT', body: {} })).status, 403);
    const confirmed = await request(`/payments/${paymentId}/confirm`, {
      who: 2, method: 'PUT', body: { note: 'ทดสอบกระทบยอด 150 บาท' }
    });
    assert.equal(confirmed.data.status, 'confirmed');
    assert.equal((await claim({ quoteId: old.quoteId })).status, 409);
    assert.equal((await request('/payments/my-status')).data.find(p => p._id === paymentId).status, 'confirmed');
    await request('/line/connection', { method: 'DELETE' });
    t.diagnostic('QR 450.00 → current 300.00; reconciliation +150; HTTP 201/200; DB payment count 1; reminder candidate count 0');
  });

  await t.test('legacy/zero/cancelled/unattended/paid excluded as applicable, and monthly write is atomic', async () => {
    const oldDate = '2026-04-10T00:00:00+07:00';
    const legacy = await lesson({ date: oldDate, coursePrice: 300 });
    const remaining = await lesson({ date: oldDate, coursePrice: 200 });
    const payFirst = await lesson({ date: oldDate });
    const excluded = await Promise.all([
      lesson({ date: oldDate, coursePrice: 0 }), lesson({ date: oldDate, status: 'cancelled' }),
      lesson({ date: oldDate, checked: [] }), lesson({ date: oldDate, students: [other._id], checked: [student._id] })
    ]);
    await Payment.create({ student: student._id, schedule: payFirst, course: course._id,
      status: 'confirmed', method: 'transfer', amount: 300 });
    for (const scheduleId of [payFirst, ...excluded]) assert.equal((await quote({ scheduleId })).status, 409);
    assert.equal(readQr((await quote({ scheduleId: legacy })).data.qrDataURL)['54'], '300.00');
    const monthQuote = (await quote({ month: '2026-04' })).data;
    assert.equal(readQr(monthQuote.qrDataURL)['54'], '500.00');
    assert.deepEqual(monthQuote.relatedSchedules.sort(), [legacy, remaining].sort());
    const original = TuitionQuote.prototype.save;
    try {
      TuitionQuote.prototype.save = async function (options) {
        if (options?.session) throw new Error('Injected failure after insertMany');
        return original.call(this, options);
      };
      assert.equal((await claim({ quoteId: monthQuote.quoteId })).status, 500);
    } finally {
      TuitionQuote.prototype.save = original;
    }
    assert.equal(await Payment.countDocuments({ tuitionQuote: monthQuote.quoteId }), 0);
    const overlaps = await Promise.all([claim({ quoteId: monthQuote.quoteId }), claim({ quoteId: monthQuote.quoteId })]);
    assert.deepEqual(overlaps.map(result => result.status).sort(), [200, 201]);
    assert.equal(await Payment.countDocuments({ tuitionQuote: monthQuote.quoteId }), 2);
    const rejectedId = overlaps[0].data.paymentIds[0];
    assert.equal((await request(`/payments/${rejectedId}/reject`, {
      who: 2, method: 'PUT', body: { note: 'test rejection' }
    })).status, 200);
    assert.equal((await request('/payments/my-status')).data.find(p => p._id === rejectedId).status, 'rejected');
    assert.equal((await quote({ month: '2026-04', resume: true })).data.relatedSchedules.length, 1);
    t.diagnostic('legacy QR 300, remaining monthly QR 500, rollback 0 rows, two retries 2 class rows, rejected reopens 1 class');
  });

  await t.test('Bangkok round, overlapping workers, accepted timeout, opt-out, block and quota', async () => {
    assert.equal((await link(4, 4)).status, 200);
    assert.equal((await link(5, 5)).status, 200);
    const beforeMidnight = await lesson({
      date: '2026-12-31T23:59:59+07:00', students: [workerStudent._id, workerOther._id]
    });
    await lesson({ date: '2027-01-01T00:00:00+07:00', students: [workerStudent._id] });
    const November = await lesson({ date: '2026-11-30T23:59:00+07:00', students: [workerStudent._id] });
    const due = new Date('2027-01-03T09:00:00+07:00');
    const preview = await previewReminders(due);
    assert.equal(preview.round, '2027-01');
    assert.deepEqual(preview.recipients.find(r => String(r.studentId) === String(workerStudent._id)).months,
      ['2026-11', '2026-12']);
    assert.equal((await quote({ month: '2026-12' }, 4)).data.relatedSchedules[0], beforeMidnight);
    await runLineReminders(due);
    assert.equal(pushes.length, 0);
    process.env.LINE_REMINDERS_ENABLED = 'true';
    await runLineReminders(new Date('2027-01-03T08:59:59.999+07:00'));
    assert.equal(pushes.length, 0);

    assert.equal((await webhook('unfollow', 5, Date.now() + 1000)).status, 200);
    pushMode = 'timeout';
    await Promise.all([runLineReminders(due), runLineReminders(due)]);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].to, ids[4]);
    const reminderLink = new URL(pushes[0].body.messages[0].template.actions[0].uri);
    assert.equal(reminderLink.searchParams.get('tuitionRound'), '2027-01');
    assert.equal(reminderLink.searchParams.get('tuitionMonth'), '2026-12');
    assert.equal(accepted.size, 1);
    const delivery = await LineReminderDelivery.findOne({ student: workerStudent._id });
    assert.equal(delivery.status, 'retry');
    await LineReminderDelivery.updateOne({ _id: delivery._id }, { nextAttemptAt: new Date(0) });
    pushMode = 'normal';
    process.env.LINE_TUITION_URL = 'https://miniapp.line.me/new-test';
    await runLineReminders(new Date('2027-01-06T09:00:00+07:00'));
    assert.equal(pushes.length, 2);
    assert.equal(pushes[0].key, pushes[1].key);
    assert.deepEqual(pushes[0].body, pushes[1].body);
    assert.equal(accepted.size, 1);
    assert.equal((await LineReminderDelivery.findById(delivery._id)).status, 'accepted');
    await runLineReminders(due);
    assert.equal(pushes.length, 2);

    const february = new Date('2027-02-10T09:00:00+07:00');
    await link(4, 4, { optedIn: false });
    await runLineReminders(february);
    assert.equal(pushes.length, 2);
    await link(4, 4);
    pushMode = 'quota';
    await runLineReminders(february);
    await runLineReminders(february);
    assert.equal(pushes.length, 3);
    assert.ok((await previewReminders(february)).quotaExceededAt);

    const march = new Date('2027-03-10T09:00:00+07:00');
    assert.equal((await previewReminders(march)).recipients.length, 1);
    await Schedule.updateMany({ students: workerStudent._id }, { coursePrice: 0 });
    await runLineReminders(march);
    assert.equal(pushes.length, 3);
    assert.equal((await previewReminders(march)).recipients.length, 0);
    await Schedule.updateOne({ _id: November }, { coursePrice: 300 });
    pushMode = 'normal';
    await runLineReminders(march);
    assert.equal(pushes.length, 4);
    assert.equal(await LineReminderDelivery.countDocuments({ round: '2027-03' }), 1);
    assert.equal(await LineReminderDelivery.countDocuments({ round: '2026-12' }), 0);
    await request('/line/connection', { who: 4, method: 'DELETE' });
    await runLineReminders(new Date('2027-04-03T09:00:00+07:00'));
    assert.equal(pushes.length, 4);
    t.diagnostic('two workers → 1 request; timeout retry → 2 HTTP requests, same key, 1 acceptance; quota → 1 request; switched off/blocked/opted out/unlinked → 0 additional requests');
  });

  await t.test('both reminder channels skip two classes covered by one KBank receipt', async testContext => {
    assert.equal((await link(4, 4)).status, 200);
    await webhook('follow', 4, Date.now() + 10_000);
    const scheduleIds = [];
    const date = '2025-01-10T00:00:00+07:00';
    for (let index = 0; index < 2; index++) {
      scheduleIds.push(await lesson({ date, students: [workerStudent._id], coursePrice: 300 }));
    }
    await Payment.create({ student: workerStudent._id, course: course._id, schedule: scheduleIds[0], scheduleIds,
      paymentType: 'monthly', paymentMonth: '2025-01', amount: 600, method: 'gateway', status: 'confirmed' });
    await lesson({ date: '2025-02-01T00:00:00+07:00', students: [workerStudent._id] });

    const emails = testContext.mock.method(emailService, 'sendPaymentReminderEmail', async () => {});
    const round = new Date('2025-02-03T09:00:00+07:00');
    const initialPushes = pushes.length;
    process.env.LINE_REMINDERS_ENABLED = 'true';
    await runPaymentReminderJob(round);
    await runLineReminders(round);
    assert.equal(emails.mock.callCount(), 0);
    assert.equal(pushes.length - initialPushes, 0);

    // Positive control shows both sender paths were active and the current month stays excluded.
    await lesson({ date, students: [workerStudent._id], coursePrice: 300 });
    await runPaymentReminderJob(round);
    await runLineReminders(round);
    assert.equal(emails.mock.callCount(), 1);
    assert.equal(emails.mock.calls[0].arguments[0].totalAmount, 300);
    assert.equal(pushes.length - initialPushes, 1);
    assert.equal(pushes.at(-1).to, ids[4]);
    testContext.diagnostic('KBank 600 THB over two 300 THB classes: 0 email calls and 0 LINE requests; unpaid control: 1 each, email 300 THB');
  });

  const unmatchedReference = 'KMS-late-session-removed-test';
  await t.test('late signed KBank success settles an expired QR once or preserves an unmatched callback', async testContext => {
    const charge = async (reference, status = 'pending') => PaymentSession.create({
      reference, status, student: workerOther._id, course: course._id,
      scheduleIds: [await lesson({ students: [workerOther._id] })],
      amount: 600, expiresAt: new Date(Date.now() - 1000)
    });
    const paidDt = new Date(Date.now() - 30_000).toISOString();
    const success = async reference => {
      const body = JSON.stringify({ partnerTxnRef: reference, paymentStatus: 'success',
        kbankTxnId: 'KBank-late-test', amount: '600.00', currency: 'THB', paidDt });
      const signature = createHmac('sha256', process.env.KBANK_WEBHOOK_SECRET).update(body).digest('hex');
      return fetch(base + '/payments/kbank/webhook', { method: 'POST', body, headers: {
        'Content-Type': 'application/json', 'X-KBank-Signature': signature
      } });
    };
    for (const previousStatus of ['pending', 'expired']) {
      const reference = `KMS-late-${previousStatus}-test`;
      await charge(reference, previousStatus);
      const poll = () => request(`/payments/kbank/status/${reference}`, { who: 5 });
      assert.equal((await poll()).data.status, 'expired');
      const deliveries = await Promise.all([success(reference), success(reference), poll()]);
      assert.equal(deliveries[0].status, 200);
      assert.equal(deliveries[1].status, 200);
      assert.equal((await poll()).data.status, 'paid');
      assert.equal((await poll()).data.paidAt, paidDt);
      const receipts = await Payment.find({ transactionRef: reference }).lean();
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].amount, 600);
      assert.equal(receipts[0].status, 'confirmed');
    }

    // Simulate a TTL deletion without waiting for the background TTL monitor.
    await charge(unmatchedReference);
    await PaymentSession.deleteOne({ reference: unmatchedReference });
    const unmatched = await Promise.all([success(unmatchedReference), success(unmatchedReference)]);
    assert.deepEqual(unmatched.map(response => response.status), [200, 200]);
    assert.equal(await Payment.countDocuments({ transactionRef: unmatchedReference }), 0);
    const review = (await request('/payments/reconciliation', { who: 2 })).data;
    assert.equal(review.bankCallbacks.length, 1);
    assert.equal(review.bankCallbacks[0]._id, unmatchedReference);
    assert.equal(review.bankCallbacks[0].amount, 600);
    assert.equal(review.bankCallbacks[0].paidAt, paidDt);
    testContext.diagnostic('Expired display and stored expired state: duplicate signed callbacks each yield exactly 1 receipt; missing session yields 1 review item and 0 receipts');
  });

  const webOnlyReference = 'KMS-web-only-legacy-test';
  await t.test('manager reconciliation includes a web-only student independently of LINE preview', async () => {
    assert.equal(await LineConnection.countDocuments({ student: webOnlyStudent._id }), 0);
    const date = '2026-10-11T00:00:00+07:00';
    const schedule = await lesson({ date, students: [webOnlyStudent._id], endTime: '11:00' });
    await lesson({ date, students: [webOnlyStudent._id], endTime: '11:00' });
    const payment = await Payment.create({ student: webOnlyStudent._id, course: course._id, schedule,
      paymentType: 'monthly', paymentMonth: '2026-10', amount: 600, method: 'gateway',
      status: 'confirmed', transactionRef: webOnlyReference });
    const details = (await bill(6)).data;
    assert.deepEqual(details.reviewMonths, ['2026-10']);
    assert.equal(details.unpaid.length, 0);
    assert.equal((await request('/payments/reconciliation', { who: 6 })).status, 403);
    const review = await request('/payments/reconciliation', { who: 2 });
    assert.equal(review.status, 200);
    assert.ok(review.data.legacyHolds.some(hold => hold.paymentId === String(payment._id)
      && hold.studentId === String(webOnlyStudent._id) && hold.reference === webOnlyReference));
    const preview = await previewReminders(new Date('2026-11-03T09:00:00+07:00'));
    assert.ok(!preview.recipients.some(item => String(item.studentId) === String(webOnlyStudent._id)));
  });

  await t.test('Chromium 390px: login, bind, download QR, resume, manager review and desktop web', {
    skip: !process.env.LINE_TEST_CHROME
  }, async () => {
    const { chromium } = require(process.env.LINE_TEST_PLAYWRIGHT || 'playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.LINE_TEST_CHROME, headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true
      });
      const allowHeaders = {
        'access-control-allow-origin': base,
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
      };
      let simulateBankFailure = true;
      async function wire(browserContext, lineId = 0) {
        await browserContext.route(/\/\/localhost:5000\/api\//, async route => {
          const request = route.request();
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: allowHeaders });
          const url = new URL(request.url());
          if (url.pathname === '/api/payments/bank-info' && simulateBankFailure) {
            return route.fulfill({ status: 502, headers: allowHeaders, json: { success: false } });
          }
          const headers = request.headers();
          const upstream = await browserContext.request.fetch(base + url.pathname.slice(4) + url.search, {
            method: request.method(),
            headers: { authorization: headers.authorization || '', 'content-type': 'application/json' },
            data: request.postData() || undefined
          });
          await route.fulfill({ status: upstream.status(), body: await upstream.body(),
            headers: { ...allowHeaders, 'content-type': 'application/json' } });
        });
        await browserContext.route('https://static.line-scdn.net/liff/**', route => route.fulfill({
          contentType: 'application/javascript',
          body: `window.liff = {
            init: async () => {}, isLoggedIn: () => true, getIDToken: () => 'id-${lineId}',
            getAccessToken: () => 'access-${lineId}'
          };`
        }));
      }
      await wire(context);
      process.env.LINE_REMINDERS_ENABLED = 'false';
      await webhook('follow', 0, Date.now() + 2000);
      const scheduleId = await lesson({ endTime: '11:30' });
      await lesson({ date: '2026-12-02T00:00:00+07:00', endTime: '11:45' });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-11-25T12:00:00+07:00'));
      page.setDefaultTimeout(12000);
      const reminderPath = '/line/tuition?tuitionRound=2026-12&tuitionMonth=2026-11';
      await page.goto(base + reminderPath);
      await page.getByRole('link', { name: 'เข้าสู่บัญชี KMS' }).click();
      await page.locator('#email').fill(student.email);
      await page.locator('#password').fill(password);
      await page.locator('button[type="submit"]').click();
      const user = await User.findById(student._id).select('+totpSecret');
      await page.locator('#otp').fill(speakeasy.totp({ secret: user.totpSecret, encoding: 'base32' }));
      await page.locator('.terms-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.locator('input[name="agree"]').check();
      await page.getByRole('button', { name: 'รับทราบและยอมรับข้อตกลง' }).click();
      await page.getByRole('checkbox', { name: /รับแจ้งเตือนค่าเรียน/ }).check();
      await page.getByRole('button', { name: 'ยืนยันการผูกบัญชี' }).click();
      await page.waitForURL('**' + reminderPath);
      await page.locator('.tuition-months button[aria-pressed="true"]').filter({ hasText: 'พ.ย.' }).waitFor();
      await page.locator('.tuition-months button[aria-pressed="false"]').filter({ hasText: 'ธ.ค.' }).waitFor();
      const classRow = page.locator('tr').filter({ hasText: '1 ชม. 30 นาที' });
      await classRow.getByRole('button', { name: 'ชำระเงิน', exact: true }).click();
      await page.getByAltText('PromptPay QR สำหรับยอดที่แสดง').waitFor();
      await page.getByText('โหลดข้อมูลบัญชีธนาคารไม่ได้', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'คัดลอก', exact: true }).count(), 0);
      assert.equal(await page.locator('.bank-account-number').count(), 0);
      simulateBankFailure = false;
      const accountName = process.env.BANK_ACCOUNT_NAME;
      process.env.BANK_ACCOUNT_NAME = '';
      const retryBank = page.getByRole('button', { name: 'ลองโหลดข้อมูลบัญชีใหม่' });
      try {
        const unavailable = page.waitForResponse(response => response.url().endsWith('/payments/bank-info'));
        await retryBank.click();
        assert.equal((await unavailable).status(), 503);
        await page.getByText('โหลดข้อมูลบัญชีธนาคารไม่ได้', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'คัดลอก', exact: true }).count(), 0);
      } finally {
        process.env.BANK_ACCOUNT_NAME = accountName;
      }
      await retryBank.click();
      await page.getByRole('button', { name: 'คัดลอก', exact: true }).waitFor();
      assert.equal(await page.locator('.bank-account-number').innerText(), process.env.BANK_ACCOUNT_NUMBER);
      const qr = await page.getByAltText('PromptPay QR สำหรับยอดที่แสดง').getAttribute('src');
      assert.equal(readQr(qr)['54'], '450.00');
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('link', { name: 'บันทึก QR' }).click();
      assert.equal((await downloadPromise).suggestedFilename(), 'kms-promptpay.png');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await Schedule.updateOne({ _id: scheduleId }, { totalDurationMinutes: 60, endTime: '11:00' });
      await page.reload();
      await page.locator('tr').filter({ hasText: '1 ชม.' }).filter({ hasText: '฿300' })
        .getByRole('button', { name: 'ชำระเงิน', exact: true }).click();
      await page.getByText('ยอดเดิม ฿450 · ยอดปัจจุบัน ฿300', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'แจ้งว่าโอนแล้ว', exact: true }).click();
      await page.getByText('รอตรวจสอบ', { exact: true }).first().waitFor();

      const desktop = await browser.newContext({ viewport: { width: 1280, height: 850 } });
      await wire(desktop);
      const managerPage = await desktop.newPage();
      await managerPage.goto(base + '/login');
      await managerPage.locator('#email').fill(users[2].email);
      await managerPage.locator('#password').fill(password);
      await managerPage.locator('button[type="submit"]').click();
      await managerPage.waitForURL('**/dashboard');
      await managerPage.goto(base + '/dashboard/revenue');
      await managerPage.getByRole('button', { name: 'ตรวจรายการแจ้งโอนค่าเรียน' }).click();
      const review = managerPage.locator('article').filter({ hasText: 'ยอดที่แจ้งโอน ฿450.00' });
      await review.getByText('ส่วนต่าง ฿150.00', { exact: false }).waitFor();
      managerPage.once('dialog', dialog => dialog.accept('ตรวจยอดทดสอบแล้ว'));
      await review.getByRole('button', { name: 'ยืนยันรับเงิน' }).click();
      await review.waitFor({ state: 'detached' });
      await managerPage.getByRole('button', { name: 'ดูตัวอย่างผู้รับแจ้งเตือน LINE' }).click();
      await managerPage.getByText(/ปิดส่ง LINE/).waitFor();
      assert.equal(await managerPage.getByText(webOnlyReference, { exact: false }).count(), 0);
      await managerPage.getByRole('button', { name: 'กระทบยอดค่าเรียน' }).click();
      await managerPage.getByText(webOnlyReference, { exact: false }).waitFor();
      await managerPage.getByText(unmatchedReference, { exact: false }).waitFor();
      await page.reload();
      await page.getByText('ชำระแล้ว', { exact: true }).last().waitFor();
      for (const [change, time, minutes, amount] of [
        [{ status: 'cancelled' }, '10:30', '30 นาที', 150],
        [{ coursePrice: 0 }, '10:45', '45 นาที', 225]
      ]) {
        const changed = await lesson({ endTime: time });
        await page.goto(base + reminderPath);
        await page.locator('tr').filter({ hasText: minutes }).getByRole('button', { name: 'ชำระเงิน', exact: true }).click();
        await page.getByAltText('PromptPay QR สำหรับยอดที่แสดง').waitFor();
        await Schedule.updateOne({ _id: changed }, change);
        await page.goto(base + reminderPath);
        await page.getByRole('button', { name: new RegExp(`แจ้งโอนยอดเดิม ฿${amount}`) }).click();
        await page.getByText(`ยอดเดิม ฿${amount} · ยอดปัจจุบัน ฿0`, { exact: true }).waitFor();
        assert.equal(await page.getByAltText('PromptPay QR สำหรับยอดที่แสดง').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'ใช้ยอดปัจจุบันและออก QR ใหม่' }).count(), 0);
        await page.getByRole('button', { name: 'แจ้งว่าโอนแล้ว', exact: true }).click();
        await page.locator('.result-state').waitFor();
      }
      const paidClasses = [];
      for (let index = 0; index < 2; index++) {
        paidClasses.push(await lesson({ date: '2026-09-10T00:00:00+07:00', endTime: '11:00' }));
      }
      await Payment.create({ student: student._id, course: course._id, schedule: paidClasses[0],
        scheduleIds: paidClasses, paymentType: 'monthly', paymentMonth: '2026-09',
        amount: 600, method: 'gateway', status: 'confirmed' });
      await page.goto(base + '/line/tuition?tuitionRound=2026-10&tuitionMonth=2026-09');
      await page.getByRole('heading', { name: /รายการ ก.ย./ }).waitFor();
      assert.equal(await page.locator('tr .badge-paid').count(), 2);
      assert.equal(await page.locator('.kpi-card.green .kpi-sub').innerText(), '฿600');
      assert.equal(await page.getByRole('button', { name: 'ชำระรายเดือนทั้งหมด' }).count(), 0);
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.goto(base + '/dashboard/payments');
      await page.getByRole('heading', { name: 'การชำระเงิน' }).waitFor();
      await page.getByRole('button', { name: 'ชำระรายเดือนทั้งหมด' }).click();
      await page.getByAltText('PromptPay QR สำหรับยอดที่แสดง').waitFor();
      if (process.env.LINE_TEST_SCREENSHOT) await page.screenshot({ path: process.env.LINE_TEST_SCREENSHOT });
      t.diagnostic('Chromium 390px: both KBank classes marked paid (600 total), Nov selected with Dec due, bank 502/503 hides copy, cancelled/zero transfers reopen, manager +150 review and desktop QR');
    } finally {
      await browser.close();
    }
  });

  await t.test('KBank monthly settlement covers both classes and holds records without evidence', async () => {
    await link(4, 4);
    const date = '2026-10-10T00:00:00+07:00';
    const first = await lesson({ date, endTime: '11:00', students: [workerStudent._id] });
    const second = await lesson({ date, endTime: '11:00', students: [workerStudent._id] });
    const reference = 'KMS-test-legacy-payment';
    const old = await Payment.create({ student: workerStudent._id, course: course._id,
      schedule: first, paymentType: 'monthly', paymentMonth: '2026-10', amount: 600,
      method: 'gateway', status: 'confirmed', transactionRef: reference });
    await PaymentSession.create({ student: workerStudent._id, course: course._id, scheduleIds: [first, second],
      paymentType: 'monthly', paymentMonth: '2026-10', amount: 600, status: 'paid', reference });
    const round = new Date('2026-11-03T09:00:00+07:00');
    const unpaidBefore = (await bill(4)).data.unpaid.filter(row => row.month === '2026-10');
    assert.deepEqual(unpaidBefore, [], 'the second class must not still be a 300 THB debt');
    assert.equal((await quote({ scheduleId: second }, 4)).status, 409);
    assert.equal((await quote({ month: '2026-10' }, 4)).status, 409);
    assert.equal((await previewReminders(round)).recipients.some(item => item.months.includes('2026-10')), false);
    const statuses = (await request('/payments/my-status', { who: 4 })).data;
    assert.deepEqual(statuses.find(item => item._id === String(old._id)).scheduleIds.sort(), [first, second].sort());
    const report = (await request(`/payments/revenue-report?month=2026-10&studentId=${workerStudent._id}`, { who: 2 })).data;
    assert.deepEqual(report.schedules.map(row => row.attendedStudents[0].paymentStatus), ['confirmed', 'confirmed']);
    assert.equal((await request('/payments/manual-confirm', {
      who: 2, method: 'POST', body: { studentId: String(workerStudent._id), scheduleId: second }
    })).status, 409);
    await PaymentSession.deleteOne({ reference });
    const reconciliation = await request('/payments/reconciliation', { who: 2 });
    assert.equal(reconciliation.data.legacyHolds.some(item => String(item.paymentId) === String(old._id)), true);
    assert.equal((await previewReminders(round)).recipients.some(item => item.months.includes('2026-10')), false);
    assert.equal((await quote({ month: '2026-10' }, 4)).status, 409);
    assert.equal((await request('/payments/bulk-confirm-month', {
      who: 2, method: 'POST', body: { studentId: String(workerStudent._id), month: '2026-10' }
    })).status, 409);

    const fresh = await request('/payments/kbank/create-charge', { who: 4, method: 'POST', body: { month: '2026-10' } });
    assert.equal(fresh.status, 409);
    const invalid = await request('/payments/kbank/create-charge', { who: 4, method: 'POST', body: { month: '2026-13' } });
    assert.equal(invalid.status, 400);
    const ids = [];
    for (let n = 0; n < 2; n++) {
      ids.push(await lesson({ date: '2026-09-10T00:00:00+07:00', endTime: '11:00', students: [workerStudent._id] }));
    }
    const charge = await request('/payments/kbank/create-charge', { who: 4, method: 'POST', body: { month: '2026-09' } });
    assert.equal(charge.status, 200);
    const pay = async (amount, validSignature = true) => {
      const body = JSON.stringify({ partnerTxnRef: charge.data.reference, kbankTxnId: 'test-kbank-txn',
        paymentStatus: 'success', amount, currency: 'THB' });
      const signature = createHmac('sha256', process.env.KBANK_WEBHOOK_SECRET).update(body).digest('hex');
      return fetch(base + '/payments/kbank/webhook', { method: 'POST', body, headers: {
        'Content-Type': 'application/json', 'X-KBank-Signature': validSignature ? signature : 'invalid'
      } });
    };
    assert.equal((await pay('600.00', false)).status, 401);
    assert.equal((await pay('300.00')).status, 400);
    assert.deepEqual((await Promise.all([pay('600.00'), pay('600.00')])).map(response => response.status), [200, 200]);
    await PaymentSession.deleteOne({ reference: charge.data.reference });
    const settled = await Payment.find({ transactionRef: charge.data.reference });
    assert.equal(settled.length, 1);
    assert.equal(settled[0].amount, 600);
    assert.deepEqual(settled[0].scheduleIds.map(String).sort(), ids.sort());
    assert.ok(!(await bill(4)).data.unpaid.some(row => row.month === '2026-09'));
    assert.equal((await quote({ month: '2026-09' }, 4)).status, 409);
    assert.equal((await previewReminders(round)).recipients.some(item => item.months.includes('2026-09')), false);
  });

  await t.test('reopens old transfers after cancellation or zero tuition without making a new bill', async () => {
    for (const change of [{ status: 'cancelled' }, { coursePrice: 0 }]) {
      const scheduleId = await lesson({ date: '2026-07-05T00:00:00+07:00', endTime: '11:30' });
      const issued = (await quote({ scheduleId })).data;
      await Schedule.updateOne({ _id: scheduleId }, change);
      const unpaid = (await bill(0)).data;
      assert.ok(!unpaid.unpaid.some(row => row.scheduleId === scheduleId));
      assert.equal((await quote({ scheduleId })).status, 409);
      const response = await quote({ scheduleId, resume: true });
      assert.equal(response.status, 200, response.message);
      assert.ok(unpaid.recoverableQuotes.some(row => row.quoteId === issued.quoteId));
      const reopened = response.data;
      assert.equal(reopened.quoteId, issued.quoteId);
      assert.equal(reopened.qrDataURL, null);
      assert.equal(reopened.currentAmount, 0);
      assert.equal((await claim({ quoteId: issued.quoteId }, 1)).status, 404);
      const result = await claim({ quoteId: issued.quoteId, amount: 1 });
      assert.equal(result.status, 201, result.message);
      assert.equal(result.data.totalAmount, 450);
      const pending = (await request('/payments/pending-verification', { who: 2 })).data;
      const review = pending.find(item => item._id === result.data.paymentIds[0]);
      assert.equal(review.amount, 450);
      assert.equal(review.currentAmount, 0);
    }
  });

  await t.test('bank details require all configured fields', async () => {
    const account = process.env.BANK_ACCOUNT_NUMBER;
    process.env.BANK_ACCOUNT_NUMBER = '   ';
    try {
      const incomplete = await request('/payments/bank-info');
      assert.equal(incomplete.status, 503);
      assert.equal(incomplete.data, undefined);
    } finally {
      process.env.BANK_ACCOUNT_NUMBER = account;
    }
    const complete = await request('/payments/bank-info');
    assert.equal(complete.status, 200);
    assert.equal(complete.data.accountNumber, account);
  });
});
