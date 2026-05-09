const jwt = require('jsonwebtoken');

// ตรวจสอบ JWT_SECRET ตั้งแต่ module load — fail fast ไม่ fallback เป็น 'default_secret'
// ถ้าไม่ตั้ง env, attacker จะ forge token ด้วย secret ที่รู้กันทั่วไปได้
if (!process.env.JWT_SECRET) {
  throw new Error('[Security] JWT_SECRET environment variable is required. Set it in .env file.');
}
if (process.env.JWT_SECRET === 'default_secret' || process.env.JWT_SECRET.length < 16) {
  throw new Error('[Security] JWT_SECRET is too weak. Use at least 16 chars of random data.');
}

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role: role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '12h' }
  );
};

const sendResponse = (res, statusCode, success, data = null, message = '', pagination = null) => {
  const response = {
    success,
    ...(data && { data }),
    message
  };

  if (pagination) {
    response.pagination = pagination;
  }

  res.status(statusCode).json(response);
};

const getPaginationParams = (query) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const createPaginationObject = (page, limit, total) => {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit)
  };
};

/**
 * คำนวณราคาคอร์สที่นักเรียนต้องจ่ายจริง สำหรับ schedule หนึ่งคน
 * - ถ้า incomeHourly = true → coursePrice เป็นยอดต่อชั่วโมง คูณกับ duration จริง
 * - ถ้า incomeHourly = false (ข้อมูลเก่า) → coursePrice เป็นยอด flat ต่อคลาส
 * ใช้ Math.round เพื่อให้ตรงกับ pattern ของ actualTeacherIncome
 */
const computeEffectivePrice = (schedule) => {
  const price = Number(schedule?.coursePrice || 0);
  if (schedule?.incomeHourly && schedule?.totalDurationMinutes > 0) {
    const hours = schedule.totalDurationMinutes / 60;
    return Math.round(price * hours);
  }
  return price;
};

module.exports = {
  generateToken,
  sendResponse,
  getPaginationParams,
  createPaginationObject,
  computeEffectivePrice
};
