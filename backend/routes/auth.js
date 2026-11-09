const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const { generateToken, sendResponse } = require('../utils/helpers');
const { authenticateToken } = require('../middleware/auth');
const { sendPasswordResetOtpEmail } = require('../services/emailService');
const { verifyEmailDomain, isDisposableDomain } = require('../utils/emailValidator');
const { TERMS_VERSION, TERMS_BY_ROLE } = require('../constants/terms');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const RESET_OTP_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 10;
const MAX_RESET_OTP_ATTEMPTS = 5;
const RESET_OTP_COOLDOWN_MS = 60_000;

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function hashResetOtp(userId, code) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`password-reset:${userId}:${code}`).digest('hex');
}

router.post('/register', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      enableTotp = true,
      phone,
      role,
      lineId,
      age,
      gender,
      paymentChannel,
      university,
      academicYear,
      nationalId,
      bankAccountNumber,
      nickname,
      // ── ข้อมูลผู้ปกครอง + ที่อยู่ (นักเรียน) ──
      guardianName,
      guardianRelation,
      parentContact,
      addressDetail,
      moo,
      soi,
      road,
      subdistrict,
      district,
      province,
      postalCode
    } = req.body;

    if (typeof enableTotp !== 'boolean') {
      return sendResponse(res, 400, false, null, 'กรุณาเลือกว่าจะเปิดใช้ Google Authenticator หรือไม่');
    }

    // Validate role
    if (!role || !['student', 'teacher'].includes(role)) {
      return sendResponse(res, 400, false, null, 'Invalid role. Only student or teacher roles can self-register');
    }

    // Validate common required fields
    if (!firstName || !lastName || !email || !password || !phone) {
      return sendResponse(res, 400, false, null, 'Missing required fields: firstName, lastName, email, password, phone');
    }

    // Validate nationalId (ทั้งครูและนักเรียนต้องกรอก)
    if (!nationalId) {
      return sendResponse(res, 400, false, null, 'กรุณากรอกเลขบัตรประชาชน');
    }
    if (!/^\d{13}$/.test(nationalId)) {
      return sendResponse(res, 400, false, null, 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
    }

    // ตรวจสอบ nationalId ซ้ำ
    const existingNationalId = await User.findOne({ nationalId });
    if (existingNationalId) {
      return sendResponse(res, 400, false, null, 'เลขบัตรประชาชนนี้ถูกใช้งานในระบบแล้ว');
    }

    // Validate teacher-specific fields
    if (role === 'teacher') {
      if (!lineId || !paymentChannel || !age || !gender || !university) {
        return sendResponse(res, 400, false, null, 'Teacher requires: lineId, paymentChannel, age, gender, university');
      }
      // บัญชีธนาคาร: ครูกรอกแค่เลขบัญชี — ชื่อบัญชีดึงจากชื่อ-นามสกุลอัตโนมัติ
      if (!bankAccountNumber) {
        return sendResponse(res, 400, false, null, 'ครูต้องกรอกเลขบัญชีธนาคาร');
      }
    }

    // Validate student-specific fields
    if (role === 'student') {
      if (!lineId || !age || !gender || !academicYear) {
        return sendResponse(res, 400, false, null, 'Student requires: lineId, age, gender, academicYear');
      }
      // บังคับข้อมูลผู้ปกครอง: ชื่อ + เบอร์ติดต่อ
      if (!guardianName || !parentContact) {
        return sendResponse(res, 400, false, null, 'กรุณากรอกชื่อผู้ปกครองและเบอร์ติดต่อผู้ปกครอง');
      }
      // เบอร์ผู้ปกครอง: ตัวเลข 9-10 หลัก และต้องไม่ซ้ำกับเบอร์นักเรียน
      const parentDigits = String(parentContact).replace(/[-\s]/g, '');
      if (!/^[0-9]{9,10}$/.test(parentDigits)) {
        return sendResponse(res, 400, false, null, 'เบอร์ผู้ปกครองต้องเป็นตัวเลข 9-10 หลัก');
      }
      if (parentDigits === String(phone).replace(/[-\s]/g, '')) {
        return sendResponse(res, 400, false, null, 'เบอร์ผู้ปกครองต้องไม่ซ้ำกับเบอร์นักเรียน');
      }
      // บังคับที่อยู่แบบละเอียด
      if (!addressDetail || !subdistrict || !district || !province || !postalCode) {
        return sendResponse(res, 400, false, null, 'กรุณากรอกที่อยู่ให้ครบ: บ้านเลขที่, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์');
      }
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      return sendResponse(res, 400, false, null, 'รูปแบบอีเมลไม่ถูกต้อง (ตัวอย่าง: name@domain.com)');
    }

    // Validate phone format (Thai: 9–10 digits, starting with 0)
    const phoneRegex = /^0[0-9]{8,9}$/;
    if (!phoneRegex.test(phone.replace(/[-\s]/g, ''))) {
      return sendResponse(res, 400, false, null, 'รูปแบบเบอร์โทรไม่ถูกต้อง (ตัวอย่าง: 0812345678)');
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return sendResponse(res, 400, false, null, 'อีเมลนี้ถูกใช้งานแล้ว');
    }

    // ตรวจสอบเบอร์โทรซ้ำ — 1 เบอร์ ต่อ 1 บัญชี
    const normalizedPhone = phone.replace(/[-\s]/g, '');
    const existingPhone = await User.findOne({ phone: normalizedPhone });
    if (existingPhone) {
      return sendResponse(res, 400, false, null, 'เบอร์โทรนี้ถูกใช้งานในระบบแล้ว');
    }

    // Verify email domain — IDN + suffix-disposable + DNS MX/A with timeout
    // ตั้งหลัง duplicate check เพื่อ:
    //   1) กัน DNS amplification (cheap checks ก่อน expensive network call)
    //   2) ไม่เสีย DNS query สำหรับ user ที่อีเมล/เบอร์ซ้ำอยู่แล้ว
    // transient resolver issues fail-open (validator return ok:true, transient:true)
    const emailCheck = await verifyEmailDomain(email);
    if (!emailCheck.ok) {
      return sendResponse(res, 400, false, null, emailCheck.reason);
    }

    // Generate TOTP secret
    const secret = enableTotp ? speakeasy.generateSecret({
      name: `KMS (${email})`,
      issuer: 'Knowledge Management System'
    }) : null;
    const qrCode = secret ? await QRCode.toDataURL(secret.otpauth_url) : undefined;

    const newUser = new User({
      firstName,
      lastName,
      email,
      password,
      phone: normalizedPhone,
      role,
      lineId,
      age,
      gender,
      nickname: nickname || undefined,
      nationalId,
      paymentChannel: role === 'teacher' ? paymentChannel : undefined,
      university: role === 'teacher' ? university : undefined,
      bankAccountNumber: role === 'teacher' ? bankAccountNumber : undefined,
      // ชื่อบัญชีดึงจากชื่อ-นามสกุลอัตโนมัติ (ครูไม่ต้องกรอกเอง)
      bankAccountName: role === 'teacher' ? `${firstName.trim()} ${lastName.trim()}` : undefined,
      academicYear: role === 'student' ? academicYear : undefined,
      // ข้อมูลผู้ปกครอง + ที่อยู่ (นักเรียนเท่านั้น)
      guardianName:  role === 'student' ? guardianName : undefined,
      guardianRelation: role === 'student' ? guardianRelation : undefined,
      parentContact: role === 'student' ? parentContact : undefined,
      addressDetail: role === 'student' ? addressDetail : undefined,
      moo:           role === 'student' ? moo : undefined,
      soi:           role === 'student' ? soi : undefined,
      road:          role === 'student' ? road : undefined,
      subdistrict:   role === 'student' ? subdistrict : undefined,
      district:      role === 'student' ? district : undefined,
      province:      role === 'student' ? province : undefined,
      postalCode:    role === 'student' ? postalCode : undefined,
      totpSecret: secret?.base32,
      totpEnabled: false,
      registrationStatus: role === 'teacher' ? 'unregistered' : 'registered'
    });

    await newUser.save();

    // Create notification for managers/admins if teacher registration
    if (role === 'teacher') {
      const Notification = require('../models/Notification');
      const managers = await User.find({ role: { $in: ['manager', 'admin'] } });

      for (const manager of managers) {
        await Notification.create({
          recipient: manager._id,
          sender: newUser._id,
          type: 'general',
          title: 'New Teacher Registration',
          message: `${firstName} ${lastName} has registered as a teacher and requires approval`,
          relatedId: newUser._id
        });
      }
    }

    sendResponse(res, 201, true, {
      userId: newUser._id.toString(),
      ...(secret && { qrCode, secret: secret.base32 }),
      user: newUser.toJSON()
    }, secret ? 'สมัครสมาชิกสำเร็จ กรุณาสแกน QR Code ด้วยแอป Google Authenticator' : 'สมัครสมาชิกสำเร็จ');
  } catch (error) {
    console.error('Register error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendResponse(res, 400, false, null, 'Email and password required');
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return sendResponse(res, 401, false, null, 'Invalid credentials');
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return sendResponse(res, 401, false, null, 'Invalid credentials');
    }

    if (!user.isActive) {
      return sendResponse(res, 403, false, null, 'Account is inactive');
    }

    // Block unconfirmed teachers — must be approved by manager/admin before login
    if (user.role === 'teacher' && user.registrationStatus === 'unregistered') {
      return sendResponse(res, 403, false, {
        pendingApproval: true,
        registrationStatus: 'unregistered'
      }, 'บัญชีของคุณอยู่ในสถานะรอการยืนยันจาก Manager โปรดติดต่อ Manager เพื่อขออนุมัติการลงทะเบียน');
    }

    // Step 2: Check 2FA — if enabled, require second-factor challenge first.
    // Frontend starts on TOTP by default; users can switch to password re-entry from there.
    if (user.totpEnabled) {
      return sendResponse(res, 200, true, {
        requireOtp: true,
        userId: user._id,
        registrationStatus: user.registrationStatus
      }, '2FA required');
    }

    // Step 3: Generate JWT
    const token = generateToken(user._id, user.role);

    sendResponse(res, 200, true, {
      user: user.toJSON(),
      token,
      registrationStatus: user.registrationStatus
    }, 'Login successful');
  } catch (error) {
    console.error('Login error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    sendResponse(res, 200, true, user.toJSON(), 'User profile retrieved');
  } catch (error) {
    console.error('Get user error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// POST /accept-terms — บันทึกการยอมรับข้อตกลงชุดใดชุดหนึ่ง (teacher / student)
// body: { docType: 'teacher' | 'student', version }
// ถือเป็นหลักฐานการแสดงเจตนายอมรับทางอิเล็กทรอนิกส์ (เก็บ version + เวลาแยกตามชุด)
router.post('/accept-terms', authenticateToken, async (req, res) => {
  try {
    const { docType, version } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    const requiredDocs = TERMS_BY_ROLE[user.role] || [];
    if (!requiredDocs.includes(docType)) {
      return sendResponse(res, 400, false, null, 'ไม่จำเป็นต้องยอมรับข้อตกลงชุดนี้สำหรับบทบาทนี้');
    }

    // ยอมรับได้เฉพาะเวอร์ชันปัจจุบันเท่านั้น — กันการส่งเวอร์ชันเก่า/ปลอม
    if (version !== TERMS_VERSION) {
      return sendResponse(res, 400, false, null, 'เวอร์ชันข้อตกลงไม่ถูกต้อง กรุณารีเฟรชหน้าเว็บแล้วลองใหม่');
    }

    if (!user.acceptedTerms) user.acceptedTerms = {};
    user.acceptedTerms[docType] = { version: TERMS_VERSION, at: new Date() };
    user.markModified('acceptedTerms');
    await user.save();

    sendResponse(res, 200, true, user.toJSON(), 'บันทึกการยอมรับข้อตกลงเรียบร้อย');
  } catch (error) {
    console.error('Accept terms error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

const refreshTokenHandler = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    const token = generateToken(user._id, user.role);
    sendResponse(res, 200, true, { token }, 'Token refreshed');
  } catch (error) {
    console.error('Refresh token error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
};

// Support both /refresh and /refresh-token (frontend uses /refresh-token)
router.post('/refresh', authenticateToken, refreshTokenHandler);
router.post('/refresh-token', authenticateToken, refreshTokenHandler);

router.post('/verify-totp-setup', async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return sendResponse(res, 400, false, null, 'userId and token required');
    }

    const user = await User.findById(userId).select('+totpSecret');
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    if (!user.totpSecret) {
      return sendResponse(res, 400, false, null, 'TOTP secret not found. Complete registration first');
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return sendResponse(res, 401, false, null, 'Invalid OTP token');
    }

    // Enable TOTP
    user.totpEnabled = true;
    await user.save();

    sendResponse(res, 200, true, {
      user: user.toJSON()
    }, 'TOTP setup verified successfully');
  } catch (error) {
    console.error('Verify TOTP setup error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

router.post('/verify-totp', async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return sendResponse(res, 400, false, null, 'userId and token required');
    }

    const user = await User.findById(userId).select('+totpSecret');
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    if (!user.totpEnabled || !user.totpSecret) {
      return sendResponse(res, 400, false, null, 'TOTP not enabled for this user');
    }

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return sendResponse(res, 401, false, null, 'Invalid OTP token');
    }

    // Block unconfirmed teachers — must be approved before getting a JWT
    if (user.role === 'teacher' && user.registrationStatus === 'unregistered') {
      return sendResponse(res, 403, false, {
        pendingApproval: true,
        registrationStatus: 'unregistered'
      }, 'บัญชีของคุณอยู่ในสถานะรอการยืนยันจาก Manager โปรดติดต่อ Manager เพื่อขออนุมัติการลงทะเบียน');
    }

    // Generate JWT token
    const jwtToken = generateToken(user._id, user.role);

    sendResponse(res, 200, true, {
      user: user.toJSON(),
      token: jwtToken
    }, 'Login successful');
  } catch (error) {
    console.error('Verify TOTP error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ── 2FA Method: ยืนยันด้วยการพิมพ์รหัสผ่านอีกครั้ง ──────────────
// ทุกบัญชีที่เปิด 2FA สามารถใช้เป็น "วิธีอื่น" สลับจาก TOTP ได้
// (ผู้ใช้ "ผ่าน" login ขั้นแรกด้วยรหัสที่ถูกต้องแล้ว — ขั้นนี้คือพิมพ์ซ้ำเป็น 2nd factor)
router.post('/verify-password-2fa', async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return sendResponse(res, 400, false, null, 'userId และรหัสผ่านจำเป็นต้องระบุ');
    }

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    if (!user.totpEnabled) {
      return sendResponse(res, 400, false, null, 'บัญชีนี้ไม่ได้เปิดใช้งาน 2FA');
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return sendResponse(res, 401, false, null, 'รหัสผ่านไม่ถูกต้อง');
    }

    // Block unconfirmed teachers — must be approved before getting a JWT
    if (user.role === 'teacher' && user.registrationStatus === 'unregistered') {
      return sendResponse(res, 403, false, {
        pendingApproval: true,
        registrationStatus: 'unregistered'
      }, 'บัญชีของคุณอยู่ในสถานะรอการยืนยันจาก Manager โปรดติดต่อ Manager เพื่อขออนุมัติการลงทะเบียน');
    }

    const jwtToken = generateToken(user._id, user.role);
    sendResponse(res, 200, true, {
      user: user.toJSON(),
      token: jwtToken
    }, 'Login successful');
  } catch (error) {
    console.error('Verify password 2FA error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ── ลืมรหัสผ่าน — ส่ง OTP ทางอีเมล ──────────────────────────────
// ไม่บอก client ว่าอีเมลมีในระบบหรือไม่ (กัน user enumeration)
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return sendResponse(res, 400, false, null, 'กรุณากรอกอีเมล');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(normalizedEmail)) {
      return sendResponse(res, 400, false, null, 'รูปแบบอีเมลไม่ถูกต้อง');
    }

    const genericMessage = 'หากอีเมลนี้มีในระบบ คุณจะได้รับรหัส OTP 6 หลักทางอีเมล';

    // Reject disposable domains (sync — no DNS). Sync check keeps response timing
    // identical for non-disposable hits/misses, preserving the user-enumeration defense.
    // Disposable accounts predate this commit; refusing to send reset links to public
    // throwaway inboxes (mailinator etc.) prevents trivial account takeover.
    const atIdx = normalizedEmail.lastIndexOf('@');
    const domain = atIdx > 0 ? normalizedEmail.slice(atIdx + 1) : '';
    if (isDisposableDomain(domain)) {
      return sendResponse(res, 200, true, null, genericMessage);
    }

    const user = await User.findOne({ email: normalizedEmail, isActive: true }).select('email').lean();
    if (user) issueResetOtp(user).catch(error => console.error('[ForgotPassword] OTP request failed:', error.name));

    return sendResponse(res, 200, true, null, genericMessage);
  } catch (error) {
    console.error('Forgot password error:', error);
    return sendResponse(res, 500, false, null, 'ขอรหัส OTP ไม่สำเร็จ กรุณาลองอีกครั้ง');
  }
});

async function issueResetOtp(user) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const now = Date.now();
  const result = await User.updateOne({
    _id: user._id,
    isActive: true,
    $or: [
      { 'passwordResetOtp.sentAt': { $exists: false } },
      { 'passwordResetOtp.sentAt': { $lte: new Date(now - RESET_OTP_COOLDOWN_MS) } }
    ]
  }, { $set: { passwordResetOtp: {
    hash: hashResetOtp(user._id, code),
    sentAt: new Date(now),
    expiresAt: new Date(now + RESET_OTP_TTL_MINUTES * 60_000),
    attempts: 0
  } } });
  if (result.modifiedCount) {
    await sendPasswordResetOtpEmail({ email: user.email, code, expiresInMinutes: RESET_OTP_TTL_MINUTES });
  }
}

router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (typeof email !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return sendResponse(res, 400, false, null, 'กรุณากรอกอีเมลและรหัส OTP 6 หลัก');
    }
    const invalid = 'รหัส OTP ไม่ถูกต้อง หมดอายุ หรือกรอกผิดครบ 5 ครั้งแล้ว';
    const user = await User.findOne({ email: email.trim().toLowerCase(), isActive: true }).select('_id').lean();
    if (!user) return sendResponse(res, 400, false, null, invalid);

    const now = Date.now();
    const hash = hashResetOtp(user._id, code);
    const eligible = {
      _id: user._id,
      isActive: true,
      'passwordResetOtp.expiresAt': { $gt: new Date(now) },
      'passwordResetOtp.attempts': { $lt: MAX_RESET_OTP_ATTEMPTS }
    };
    const token = crypto.randomBytes(32).toString('hex');
    const result = await User.updateOne({ ...eligible, 'passwordResetOtp.hash': hash }, {
      $set: {
        resetPasswordTokenHash: hashResetToken(token),
        resetPasswordExpires: new Date(now + RESET_TOKEN_TTL_MINUTES * 60_000)
      },
      $unset: { 'passwordResetOtp.hash': '', 'passwordResetOtp.expiresAt': '' }
    });
    if (!result.modifiedCount) {
      await User.updateOne({ ...eligible, 'passwordResetOtp.hash': { $ne: hash } },
        { $inc: { 'passwordResetOtp.attempts': 1 } });
      return sendResponse(res, 400, false, null, invalid);
    }

    res.set('Cache-Control', 'no-store');
    return sendResponse(res, 200, true, { token }, 'ยืนยันรหัส OTP สำเร็จ');
  } catch (error) {
    console.error('[ForgotPassword] OTP verification failed:', error.name);
    return sendResponse(res, 500, false, null, 'ยืนยันรหัส OTP ไม่สำเร็จ กรุณาลองอีกครั้ง');
  }
});

// ── ตั้งรหัสผ่านใหม่ด้วย token ─────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[a-f\d]{64}$/i.test(token) || !password) {
      return sendResponse(res, 400, false, null, 'token และ password จำเป็นต้องระบุ');
    }
    if (typeof password !== 'string' || password.length < 6) {
      return sendResponse(res, 400, false, null, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    }
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return sendResponse(res, 400, false, null, 'รหัสผ่านยาวเกิน 72 ไบต์');
    }

    const tokenFilter = {
      isActive: true,
      resetPasswordTokenHash: hashResetToken(token)
    };
    const invalid = 'คำขอตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว';
    if (!await User.exists({ ...tokenFilter, resetPasswordExpires: { $gt: new Date() } })) {
      return sendResponse(res, 400, false, null, invalid);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await User.updateOne({
      ...tokenFilter, resetPasswordExpires: { $gt: new Date() }
    }, {
      $set: { password: passwordHash, updatedAt: new Date() },
      $unset: { resetPasswordTokenHash: '', resetPasswordExpires: '', passwordResetOtp: '' }
    });

    if (!result.modifiedCount) {
      return sendResponse(res, 400, false, null, invalid);
    }

    return sendResponse(res, 200, true, null, 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
  } catch (error) {
    console.error('Reset password error:', error);
    return sendResponse(res, 500, false, null, 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ กรุณาลองอีกครั้ง');
  }
});

router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return sendResponse(res, 400, false, null, 'Current and new password required');
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      return sendResponse(res, 401, false, null, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save();

    sendResponse(res, 200, true, null, 'Password changed successfully');
  } catch (error) {
    console.error('Change password error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
