const Course = require('../models/Course');
const Payment = require('../models/Payment');

// ── สถานะการชำระเงินคอร์ส ─────────────────────────────────────────────────
// คลาสที่เป็นคอร์ส (isCoursePackage) นักเรียนต้องจ่ายทั้งคอร์ส (confirmed) ก่อน
// จึงจะทำ action ใดๆ ของคลาสได้ — จ่ายครั้งเดียวครอบคลุมทุกคาบในชุด (seriesId)
//
// คืน Set ของ studentId (string) ที่ชำระเงินคอร์สนี้แล้ว (confirmed)
async function paidStudentIdSet(course) {
  if (!course) return new Set();
  const seriesId = course.seriesId;
  const anchorId = course._id || course;
  let courseIds = [anchorId];
  if (seriesId) {
    const sibs = await Course.find({ seriesId }).select('_id');
    if (sibs.length > 0) courseIds = sibs.map(c => c._id);
  }
  const payments = await Payment.find({
    course: { $in: courseIds },
    paymentType: 'course',
    status: 'confirmed'
  }).select('student');
  return new Set(payments.map(p => p.student.toString()));
}

// นักเรียนคนนี้จ่ายคอร์สแล้วหรือยัง (ใช้กับ action รายคน เช่น เช็คชื่อ/นักเรียนยืนยัน)
async function isStudentPaid(course, studentId) {
  const set = await paidStudentIdSet(course);
  return set.has(String(studentId));
}

// คลาสนี้พร้อมทำ action ระดับคลาสหรือยัง (ครูยืนยัน/เปิด QR/manager ยืนยัน)
// = นักเรียนทุกคนในคลาสจ่ายคอร์สครบแล้ว
async function isClassFullyPaid(schedule, course) {
  if (!course?.isCoursePackage) return true;   // ไม่ใช่คอร์ส → ไม่ล็อค
  const students = Array.isArray(schedule.students) ? schedule.students : [];
  if (students.length === 0) return true;
  const set = await paidStudentIdSet(course);
  return students.every(s => set.has(String(s._id || s)));
}

// ── Batch: คำนวณสถานะชำระเงินคอร์สของหลาย Course พร้อมกัน (กัน N+1) ──
// รับ array ของ Course docs (ต้องมี _id, isCoursePackage, seriesId, students)
// คืน Map<courseId, { isPackage, fullyPaid, paidCount, totalStudents }>
async function buildCoursePaymentMap(courses) {
  const result = new Map();
  const pkg = (courses || []).filter(c => c && c.isCoursePackage);
  if (pkg.length === 0) return result;

  const seriesIds = [...new Set(pkg.map(c => c.seriesId).filter(Boolean))];
  const anchorIds = pkg.filter(c => !c.seriesId).map(c => c._id);

  const or = [];
  if (seriesIds.length) or.push({ seriesId: { $in: seriesIds } });
  if (anchorIds.length) or.push({ course: { $in: anchorIds } });
  if (or.length === 0) return result;

  const payments = await Payment.find({
    paymentType: 'course', status: 'confirmed', $or: or
  }).select('student seriesId course');

  const bySeries = new Map();
  const byCourse = new Map();
  for (const p of payments) {
    const sid = p.student.toString();
    if (p.seriesId) {
      if (!bySeries.has(p.seriesId)) bySeries.set(p.seriesId, new Set());
      bySeries.get(p.seriesId).add(sid);
    } else if (p.course) {
      const cid = p.course.toString();
      if (!byCourse.has(cid)) byCourse.set(cid, new Set());
      byCourse.get(cid).add(sid);
    }
  }

  for (const c of pkg) {
    const paidSet = c.seriesId ? (bySeries.get(c.seriesId) || new Set())
                               : (byCourse.get(c._id.toString()) || new Set());
    const students = (c.students || []).map(s => (s._id || s).toString());
    const paidCount = students.filter(id => paidSet.has(id)).length;
    result.set(c._id.toString(), {
      isPackage: true,
      fullyPaid: students.length > 0 && paidCount === students.length,
      paidCount,
      totalStudents: students.length,
      paidStudentIds: students.filter(id => paidSet.has(id))
    });
  }
  return result;
}

module.exports = { paidStudentIdSet, isStudentPaid, isClassFullyPaid, buildCoursePaymentMap };
