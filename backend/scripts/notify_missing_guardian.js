/**
 * One-time notify: email students who registered before guardian-info became
 * mandatory, asking them to fill in guardian name / contact / detailed address.
 *
 * "Missing" = student role, isActive, and any of the required fields empty:
 *   guardianName, parentContact, addressDetail, subdistrict, district,
 *   province, postalCode.
 *
 *   node scripts/notify_missing_guardian.js          # send emails
 *   node scripts/notify_missing_guardian.js --dry    # preview only (no email)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const User = require('../models/User');
const { sendGuardianInfoReminderEmail } = require('../services/emailService');

const DRY = process.argv.includes('--dry');
const PROFILE_LINK = (process.env.FRONTEND_URL || 'http://localhost:4200').replace(/\/+$/, '') + '/dashboard/profile';

const REQUIRED = ['guardianName', 'parentContact', 'addressDetail', 'subdistrict', 'district', 'province', 'postalCode'];

function isMissing(u) {
  return REQUIRED.some(f => !u[f] || !String(u[f]).trim());
}

(async () => {
  await connectDB();
  const students = await User.find({ role: 'student', isActive: true });
  const targets = students.filter(isMissing);

  let sent = 0, failed = 0;
  for (const u of targets) {
    const studentName = u.nickname || `${u.firstName} ${u.lastName}`.trim();
    if (DRY) {
      console.log(`[dry] would email ${u.email} (${studentName}) — missing: ${REQUIRED.filter(f => !u[f] || !String(u[f]).trim()).join(', ')}`);
      continue;
    }
    const res = await sendGuardianInfoReminderEmail({
      studentEmail: u.email,
      studentName,
      profileLink: PROFILE_LINK
    });
    if (res.success) { sent++; console.log(`sent -> ${u.email}`); }
    else { failed++; console.warn(`failed -> ${u.email}: ${res.error || res.skipped ? 'skipped/SMTP not configured' : 'unknown'}`); }
  }

  console.log(`${DRY ? '[dry] ' : ''}${targets.length} student(s) missing guardian info` +
    (DRY ? '' : ` — sent ${sent}, failed ${failed}`) + ` / ${students.length} total`);
  await mongoose.connection.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
