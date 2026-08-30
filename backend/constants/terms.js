// ข้อตกลงการใช้บริการ (Terms of Service) — เวอร์ชันปัจจุบัน
// เนื้อหาข้อตกลงฉบับเต็มอยู่ฝั่ง frontend (shared/constants/terms.ts)
// backend เก็บเฉพาะเวอร์ชันไว้ตรวจสอบว่า user ยอมรับฉบับล่าสุดแล้วหรือยัง
//
// เมื่อแก้ไขเนื้อหาข้อตกลงที่มีสาระสำคัญ → bump ค่านี้ (และฝั่ง frontend ให้ตรงกัน)
// ผู้ใช้ทุกคนจะถูกบังคับให้ยอมรับฉบับใหม่อีกครั้งอัตโนมัติ
const TERMS_VERSION = '1.0';

// ชุดเอกสารข้อตกลงที่แต่ละ role ต้องยอมรับก่อนใช้งาน
//   teacher → ชุดครู, student → ชุดนักเรียน, admin/manager → ทั้งสองชุด
const TERMS_BY_ROLE = {
  teacher: ['teacher'],
  student: ['student'],
  admin: ['teacher', 'student'],
  manager: ['teacher', 'student']
};

module.exports = { TERMS_VERSION, TERMS_BY_ROLE };
