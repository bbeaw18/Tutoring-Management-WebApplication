/**
 * One-off: recompute User.teachingHours / learningHours จากความจริงในฐานข้อมูล
 *
 * แหล่งความจริง (ตรงกับ schedules.js PATCH /:id/manager-confirm):
 *   - teachingHours[teacher] = Σ durationHours ของ Schedule ที่ status==='completed'
 *   - learningHours[student] = Σ durationHours ของ Schedule completed ที่นักเรียนคนนั้นมี Attendance
 *   - durationHours = (schedule.totalDurationMinutes || 0) / 60  (นับเฉพาะ > 0)
 *
 * คลาสที่ถูกยกเลิก/ลบจะไม่ถูกนับ — แก้ปัญหาชั่วโมงสะสมค้างจากคลาสที่
 * ยกเลิกก่อนมี fix การย้อน hours
 *
 * Usage:
 *   node scripts/recompute-hours.js            # dry-run: แสดง diff เฉย ๆ ไม่เขียน
 *   node scripts/recompute-hours.js --apply    # เขียนค่าใหม่ลง DB จริง
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Schedule = require('../models/Schedule');
const Attendance = require('../models/Attendance');

const APPLY = process.argv.includes('--apply');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI not found in .env file');
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? 'APPLY (writes to DB)' : 'DRY-RUN (no writes)'}`);
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.\n');

  // ── 1) completed schedules + duration ──
  const completed = await Schedule.find({ status: 'completed' })
    .select('_id teacher totalDurationMinutes');

  const durBySchedule = new Map();   // scheduleId -> durationHours
  const teaching = new Map();        // teacherId  -> Σ hours
  for (const s of completed) {
    const dur = (s.totalDurationMinutes || 0) / 60;
    if (dur <= 0) continue;
    durBySchedule.set(s._id.toString(), dur);
    if (s.teacher) {
      const tid = s.teacher.toString();
      teaching.set(tid, (teaching.get(tid) || 0) + dur);
    }
  }

  // ── 2) learning hours จาก Attendance ของ schedule ที่ completed ──
  const learning = new Map();        // studentId -> Σ hours
  const completedIds = [...durBySchedule.keys()];
  if (completedIds.length > 0) {
    const atts = await Attendance.find({ schedule: { $in: completedIds } })
      .select('student schedule');
    for (const a of atts) {
      const dur = durBySchedule.get(a.schedule.toString());
      if (!dur || !a.student) continue;
      const sid = a.student.toString();
      learning.set(sid, (learning.get(sid) || 0) + dur);
    }
  }

  console.log(`Completed schedules counted: ${durBySchedule.size}`);
  console.log(`Teachers with hours: ${teaching.size} | Students with hours: ${learning.size}\n`);

  // ── 3) diff เทียบค่าปัจจุบัน ──
  const users = await User.find({}).select('_id firstName lastName nickname role teachingHours learningHours');
  const ops = [];
  let changed = 0;

  for (const u of users) {
    const id = u._id.toString();
    const newTeach = round2(teaching.get(id) || 0);
    const newLearn = round2(learning.get(id) || 0);
    const curTeach = round2(u.teachingHours || 0);
    const curLearn = round2(u.learningHours || 0);

    if (newTeach !== curTeach || newLearn !== curLearn) {
      changed++;
      const name = (u.nickname || `${u.firstName || ''} ${u.lastName || ''}`).trim() || id;
      console.log(
        `[${u.role}] ${name}: ` +
        `teaching ${curTeach} -> ${newTeach}` +
        ` | learning ${curLearn} -> ${newLearn}`
      );
      ops.push({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { teachingHours: newTeach, learningHours: newLearn } }
        }
      });
    }
  }

  console.log(`\nUsers needing update: ${changed} / ${users.length}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — ไม่มีการเขียน. รันซ้ำด้วย --apply เพื่อบันทึกจริง');
  } else if (ops.length > 0) {
    const r = await User.bulkWrite(ops);
    console.log(`\nApplied. modified=${r.modifiedCount}`);
  } else {
    console.log('\nไม่มีอะไรต้องอัปเดต');
  }

  await mongoose.connection.close();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('recompute-hours failed:', err);
  try { await mongoose.connection.close(); } catch (_) {}
  process.exit(1);
});
