const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, sendResponse } = require('../utils/helpers');
const { authenticateToken } = require('../middleware/auth');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

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
      bankAccountName,
      nickname
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
      // บัญชีธนาคาร: ต้องกรอกเลขบัญชีและชื่อบัญชี
      if (!bankAccountNumber || !bankAccountName) {
        return sendResponse(res, 400, false, null, 'ครูต้องกรอกเลขบัญชีธนาคารและชื่อบัญชี');
      }
      // ชื่อบัญชีต้องตรงกับ ชื่อ-นามสกุล (case-insensitive, trim)
      const expectedName = `${firstName.trim()} ${lastName.trim()}`.toLowerCase();
      if (bankAccountName.trim().toLowerCase() !== expectedName) {
        return sendResponse(res, 400, false, null, `ชื่อบัญชีธนาคารต้องตรงกับชื่อ-นามสกุล: "${firstName} ${lastName}"`);
      }
    }

    // Validate student-specific fields
    if (role === 'student') {
      if (!lineId || !age || !gender || !academicYear) {
        return sendResponse(res, 400, false, null, 'Student requires: lineId, age, gender, academicYear');
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
      bankAccountName: role === 'teacher' ? bankAccountName : undefined,
      academicYear: role === 'student' ? academicYear : undefined,
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

    // Step 2: Check TOTP — if enabled, require OTP first
    if (user.totpEnabled) {
      return sendResponse(res, 200, true, {
        requireOtp: true,
        userId: user._id,
        registrationStatus: user.registrationStatus
      }, 'OTP required');
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
