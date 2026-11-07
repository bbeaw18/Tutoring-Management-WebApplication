const express = require('express');
const { isObjectIdOrHexString } = require('mongoose');
const Schedule = require('../models/Schedule');
const TeacherAvailability = require('../models/TeacherAvailability');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse } = require('../utils/helpers');

const router = express.Router();
const dayMs = 24 * 60 * 60 * 1000;
const bangkokOffset = 7 * 60 * 60 * 1000;
const dayMinutes = 24 * 60;
const startsAt = Date.parse(process.env.TEACHER_AVAILABILITY_START_AT ?? '2026-11-09T00:00:00+07:00');
if (!Number.isFinite(startsAt)) throw new Error('TEACHER_AVAILABILITY_START_AT must be a valid date and time');

router.use(authenticateToken);
router.get('/status', roleCheck(['teacher', 'manager', 'admin']), (req, res) => {
  const serverTime = Date.now();
  res.set('Cache-Control', 'no-store');
  sendResponse(res, 200, true, { enabled: serverTime >= startsAt, startsAt, serverTime });
});
router.use((req, res, next) => {
  if (Date.now() < startsAt) {
    return sendResponse(res, 403, false, null, 'ระบบแจ้งเวลาว่างยังไม่เปิดใช้งาน');
  }
  next();
});
router.param('weekStart', (req, res, next, weekStart) => {
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || date.getUTCDay() !== 1 ||
      date.toISOString().slice(0, 10) !== weekStart) {
    return sendResponse(res, 400, false, null, 'กรุณาระบุวันที่เริ่มสัปดาห์เป็นวันจันทร์');
  }
  req.availabilityWeek = date.getTime();
  next();
});

function normalizeSlots(slots) {
  if (!Array.isArray(slots) || slots.length > 672) return null;
  if (!slots.every(slot => slot && Number.isInteger(slot.day) && slot.day >= 0 && slot.day < 7 &&
      Number.isInteger(slot.start) && Number.isInteger(slot.end) &&
      slot.start >= 0 && slot.start < slot.end && slot.end <= dayMinutes)) return null;

  const sorted = slots.map(({ day, start, end }) => ({ day, start, end }))
    .sort((a, b) => a.day - b.day || a.start - b.start);
  const merged = [];
  for (const slot of sorted) {
    const previous = merged[merged.length - 1];
    if (previous?.day === slot.day && previous.end >= slot.start) previous.end = Math.max(previous.end, slot.end);
    else merged.push(slot);
  }
  return merged;
}

function minutes(time) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(time)) return NaN;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

async function getClasses(teacher, week) {
  // Include the preceding Sunday for classes that finish after midnight on Monday.
  const schedules = await Schedule.find({
    teacher,
    date: { $gte: new Date(week - dayMs - bangkokOffset), $lt: new Date(week + 7 * dayMs - bangkokOffset) },
    status: { $ne: 'cancelled' }
  }).select('course date startTime endTime').populate('course', 'name subject')
    .sort({ date: 1, startTime: 1 }).lean();
  return schedules.flatMap(schedule => {
    const day = Math.floor((schedule.date.getTime() + bangkokOffset - week) / dayMs);
    const start = minutes(schedule.startTime);
    const end = minutes(schedule.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= dayMinutes) return [];
    const blocks = (end > start ? [{ day, start, end }] : [
      { day, start, end: dayMinutes }, { day: day + 1, start: 0, end }
    ]).filter(block => block.day >= 0 && block.day < 7 && block.end > block.start);
    if (!blocks.length) return [];
    const date = new Date(week + day * dayMs).toISOString().slice(0, 10);
    return [{
      id: String(schedule._id),
      key: `${schedule._id}|${date}|${schedule.startTime}|${schedule.endTime}`,
      name: schedule.course?.name || schedule.course?.subject || 'คลาสสอน',
      date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      blocks
    }];
  });
}

function subtractClasses(slots, classes) {
  let free = slots;
  for (const { blocks } of classes) {
    for (const busy of blocks) {
      free = free.flatMap(slot => {
        if (slot.day !== busy.day || slot.start >= busy.end || busy.start >= slot.end) return [slot];
        const remaining = [];
        if (slot.start < busy.start) remaining.push({ ...slot, end: busy.start });
        if (slot.end > busy.end) remaining.push({ ...slot, start: busy.end });
        return remaining;
      });
    }
  }
  return free;
}

function weekData(record, classes) {
  const slots = record?.slots || [];
  return { saved: !!record, slots, classes, freeSlots: subtractClasses(slots, classes) };
}

router.get('/:weekStart', roleCheck(['teacher', 'manager', 'admin']), async (req, res, next) => {
  try {
    const teacher = req.user.role === 'teacher' ? req.user.id : req.query.teacherId;
    if (!isObjectIdOrHexString(teacher)) return sendResponse(res, 400, false, null, 'กรุณาเลือกครูผู้สอน');
    const [record, classes] = await Promise.all([
      TeacherAvailability.findOne({ teacher, weekStart: req.params.weekStart }).lean(),
      getClasses(teacher, req.availabilityWeek)
    ]);
    sendResponse(res, 200, true, weekData(record, classes));
  } catch (error) {
    next(error);
  }
});

router.put('/:weekStart', roleCheck(['teacher']), async (req, res, next) => {
  try {
    const slots = normalizeSlots(req.body?.slots);
    if (!slots) return sendResponse(res, 400, false, null, 'กรุณาตรวจสอบวันและช่วงเวลา');
    const teacher = req.user.id;
    const classes = await getClasses(teacher, req.availabilityWeek);
    const conflicts = classes.filter(lesson => lesson.blocks.some(busy =>
      slots.some(slot => slot.day === busy.day && slot.start < busy.end && busy.start < slot.end)));
    const keys = Array.isArray(req.body.confirmedConflicts) ? new Set(req.body.confirmedConflicts) : new Set();
    if (conflicts.some(lesson => !keys.has(lesson.key))) {
      return sendResponse(res, 409, false, { conflicts, classes }, 'คุณมีคลาสสอนที่นัดล่วงหน้าอยู่');
    }

    const filter = { teacher, weekStart: req.params.weekStart };
    await TeacherAvailability.init();
    let record;
    try {
      record = await TeacherAvailability.findOneAndUpdate(filter, { $set: { slots } },
        { upsert: true, new: true, runValidators: true }).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      record = await TeacherAvailability.findOneAndUpdate(filter, { $set: { slots } },
        { new: true, runValidators: true }).lean();
    }
    sendResponse(res, 200, true, weekData(record, classes), 'บันทึกเวลาว่างแล้ว');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
