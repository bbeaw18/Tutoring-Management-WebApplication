const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { generateToken, sendResponse } = require('../utils/helpers');
const { authenticateToken } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/emailService');
const { verifyEmailDomain, isDisposableDomain } = require('../utils/emailValidator');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const RESET_TOKEN_TTL_MINUTES = 60;

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

router.post('/register', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
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
    const secret = speakeasy.generateSecret({
      name: `KMS (${email})`,
      issuer: 'Knowledge Management System'
    });

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
      totpSecret: secret.base32,
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

    // Generate QR code
    const otpauthUrl = secret.otpauth_url;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Return userId and qrCode at top level so frontend can directly access them
    sendResponse(res, 201, true, {
      userId: newUser._id.toString(),
      qrCode: qrCodeDataUrl,
      secret: secret.base32,
      user: newUser.toJSON()
    }, 'สมัครสมาชิกสำเร็จ กรุณาสแกน QR Code ด้วยแอป Google Authenticator');
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

    const user = await User.findById(userId);
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

    const user = await User.findById(userId);
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

// ── ลืมรหัสผ่าน — สร้าง token + ส่งอีเมล ─────────────────────────
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

    const genericMessage = 'หากอีเมลนี้มีในระบบ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณแล้ว';

    // Reject disposable domains (sync — no DNS). Sync check keeps response timing
    // identical for non-disposable hits/misses, preserving the user-enumeration defense.
    // Disposable accounts predate this commit; refusing to send reset links to public
    // throwaway inboxes (mailinator etc.) prevents trivial account takeover.
    const atIdx = normalizedEmail.lastIndexOf('@');
    const domain = atIdx > 0 ? normalizedEmail.slice(atIdx + 1) : '';
    if (isDisposableDomain(domain)) {
      return sendResponse(res, 200, true, null, genericMessage);
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

      user.resetPasswordTokenHash = tokenHash;
      user.resetPasswordExpires = expiresAt;
      await user.save();

      const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:4200').replace(/\/+$/, '');
      const resetLink = `${frontendBase}/reset-password?token=${rawToken}`;

      // อย่า await — ส่งอีเมลพื้นหลัง กัน timing-attack
      // (ถึงไม่ส่งได้/ส่งช้า client ก็ได้ response เหมือนเดิม)
      sendPasswordResetEmail({
        email: user.email,
        userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        resetLink,
        expiresInMinutes: RESET_TOKEN_TTL_MINUTES
      }).catch(err => console.error('[ForgotPassword] email error:', err.message));
    }

    return sendResponse(res, 200, true, null, genericMessage);
  } catch (error) {
    console.error('Forgot password error:', error);
    return sendResponse(res, 500, false, null, error.message);
  }
});

// ── ตั้งรหัสผ่านใหม่ด้วย token ─────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return sendResponse(res, 400, false, null, 'token และ password จำเป็นต้องระบุ');
    }
    if (typeof password !== 'string' || password.length < 6) {
      return sendResponse(res, 400, false, null, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    }

    const tokenHash = hashResetToken(String(token));
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() }
    }).select('+password +resetPasswordTokenHash +resetPasswordExpires');

    if (!user) {
      return sendResponse(res, 400, false, null, 'ลิงก์ตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว');
    }

    user.password = password;            // pre-save hook จะ hash อัตโนมัติ
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpires = null;
    await user.save();

    return sendResponse(res, 200, true, null, 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
  } catch (error) {
    console.error('Reset password error:', error);
    return sendResponse(res, 500, false, null, error.message);
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
