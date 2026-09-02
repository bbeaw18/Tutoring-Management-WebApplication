/**
 * Detect & repair "orphan" finalized sessions with no attendance.
 *
 * Symptom: a 1:1 class was closed + manager-confirmed (status 'completed' or
 * 'awaiting_confirmation') but NO Attendance record exists for the enrolled
 * student — e.g. an admin closed the QR while attendanceCount was still 0
 * (allowed for admins, schedules.js close-qr). Consequences:
 *   - actualTeacherIncome was computed against 0 attendees -> 0
 *   - /revenue-report skips the student row (attendances.length === 0)
 *   - the student is never billed; teacher-history shows the class at 0 baht
 *
 * This finds finalized schedules with 0 attendance but exactly ONE enrolled
 * student (unambiguous who attended), then repairs each by:
 *   - creating the missing Attendance for that student
 *   - recomputing actualTeacherIncome = computeEffectiveTeacherIncome(s, 1)
 *   - crediting the student's learningHours (manager-confirm had skipped it;
 *     the teacher's teachingHours was already credited at confirm time)
 * Idempotent — re-running skips schedules that now have attendance.
 *
 * Group classes (>1 enrolled) are only REPORTED, never auto-repaired, because
 * we can't know which students actually attended.
 *
 *   node scripts/fix_orphan_checked_sessions.js --dry     # preview only
 *   node scripts/fix_orphan_checked_sessions.js           # apply
 *   node scripts/fix_orphan_checked_sessions.js --only=<id>[,<id>]  # limit to ids
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
require('../models/Course'); // register for populate
const { computeEffectiveTeacherIncome } = require('../utils/helpers');

const DRY = process.argv.includes('--dry');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : null;

function classStartDate(schedule) {
  const d = new Date(schedule.date);
  const dateStr = new Date(d.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
  return new Date(`${dateStr}T${schedule.startTime || '00:00'}:00+07:00`);
}

(async () => {
  await connectDB();

  const finalized = await Schedule.find({ status: { $in: ['completed', 'awaiting_confirmation'] } })
    .populate('teacher', 'nickname firstName lastName')
    .populate('students', 'nickname firstName lastName')
    .populate('course', 'name');

  let repaired = 0, reportedGroups = 0, anomalies = 0;

  for (const s of finalized) {
    const cnt = await Attendance.countDocuments({ schedule: s._id });
    const students = s.students || [];
    if (cnt !== 0 || students.length < 1) continue; // has attendance or no enrolled -> fine

    anomalies++;
    const sid = s._id.toString();
    if (ONLY && !ONLY.includes(sid)) continue;

    const t = s.teacher ? (s.teacher.nickname || s.teacher.firstName) : '-';
    const label = `sch=${sid} ${new Date(s.date).toISOString().split('T')[0]} ${s.startTime} ` +
      `teacher=${t} status=${s.status} course="${s.course && s.course.name}"`;

    if (students.length > 1) {
      console.log(`[report-only group ${students.length}] ${label} — manual review needed`);
      reportedGroups++;
      continue;
    }

    // exactly one enrolled student -> unambiguous repair
    const student = students[0];
    const income = computeEffectiveTeacherIncome(s, 1);
    const durationHours = (s.totalDurationMinutes || 0) / 60;
    console.log(
      `${DRY ? '[dry] ' : ''}[repair 1:1] ${label} student=${student.nickname || student.firstName} ` +
      `income:${s.actualTeacherIncome} -> ${income} learningHours+=${durationHours.toFixed(1)}`
    );

    if (!DRY) {
      await Attendance.create({
        schedule: s._id,
        student: student._id,
        scannedAt: classStartDate(s),
        deviceInfo: 'backfill-orphan-checkin'
      });
      s.actualTeacherIncome = income;
      await s.save();
      if (durationHours > 0) {
        await User.findByIdAndUpdate(student._id, { $inc: { learningHours: durationHours } });
      }
    }
    repaired++;
  }

  console.log(
    `${DRY ? '[dry] would repair' : 'repaired'} ${repaired} 1:1 session(s); ` +
    `${reportedGroups} group session(s) reported for manual review ` +
    `(total anomalies ${anomalies} / scanned ${finalized.length} finalized)`
  );
  await mongoose.connection.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
