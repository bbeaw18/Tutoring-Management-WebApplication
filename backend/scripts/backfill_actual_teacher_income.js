/**
 * One-time backfill: re-derive actualTeacherIncome for finished schedules.
 *
 * actualTeacherIncome is a snapshot frozen at class close. Before the
 * edit-booking recompute fix, correcting a teacher rate left this snapshot
 * stale, so teaching-history / revenue showed the pre-edit income. This
 * script recomputes the snapshot from the current rate + attendance for every
 * completed / awaiting_confirmation schedule. Idempotent — safe to re-run.
 *
 *   node scripts/backfill_actual_teacher_income.js          # apply
 *   node scripts/backfill_actual_teacher_income.js --dry    # preview only
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');
const { computeEffectiveTeacherIncome } = require('../utils/helpers');

const DRY = process.argv.includes('--dry');

(async () => {
  await connectDB();
  const list = await Schedule.find({ status: { $in: ['completed', 'awaiting_confirmation'] } });
  let changed = 0;
  for (const s of list) {
    const att = await Attendance.countDocuments({ schedule: s._id });
    const next = computeEffectiveTeacherIncome(s, att);
    if (next !== (s.actualTeacherIncome || 0)) {
      console.log(`${DRY ? '[dry] ' : ''}sch=${s._id} status=${s.status} att=${att} dur=${s.totalDurationMinutes} ind=${s.teacherIncomeIndividual} grp=${s.teacherIncomeGroup}  ${s.actualTeacherIncome} -> ${next}`);
      if (!DRY) { s.actualTeacherIncome = next; await s.save(); }
      changed++;
    }
  }
  console.log(`${DRY ? '[dry] would update' : 'updated'} ${changed} / ${list.length} finished schedules`);
  await mongoose.connection.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
