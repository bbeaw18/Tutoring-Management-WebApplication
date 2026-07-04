const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse, getPaginationParams, createPaginationObject } = require('../utils/helpers');

// ─── STATIC ROUTES FIRST (before /:id dynamic routes) ───────────────────────

// GET /pending-teachers — Manager/Admin can view pending teacher registrations
router.get('/pending-teachers', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { search } = req.query;

    let query = { role: 'teacher', registrationStatus: 'unregistered' };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(query);
    const teachers = await User.find(query)
      .populate('approvedBy', 'firstName lastName nickname email')
      .select('-password')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, teachers, 'Pending teachers retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get pending teachers error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// GET /teachers — List all teachers
// Query: ?includeManager=true เพื่อรวม manager (ผู้ที่สามารถสอนได้) ในผลลัพธ์
router.get('/teachers', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { search, includeManager } = req.query;

    // ถ้า ?includeManager=true → รวม manager ที่อาจเป็นผู้สอนด้วย
    const roleQuery = includeManager === 'true'
      ? { role: { $in: ['teacher', 'manager'] } }
      : { role: 'teacher' };

    let query = { ...roleQuery };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(query);
    const teachers = await User.find(query)
      .select('-password')
      .limit(limit)
      .skip(skip)
      .sort({ teachingHours: -1 });

    sendResponse(res, 200, true, teachers, 'Teachers retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get teachers error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// GET /teaching-staff — List all teachers + managers (ผู้สอนทั้งหมด)
router.get('/teaching-staff', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { search, includeAdmin } = req.query;
    // includeAdmin=true → รวม admin ด้วย (ใช้ในตัวเลือกบุคลากรของหน้า revenue)
    const roles = includeAdmin === 'true'
      ? ['teacher', 'manager', 'admin']
      : ['teacher', 'manager'];
    let query = { role: { $in: roles }, isActive: true };

    if (search) {
      query.$and = [
        { role: { $in: roles } },
        { $or: [
            { firstName: { $regex: search, $options: 'i' } },
            { lastName:  { $regex: search, $options: 'i' } },
            { email:     { $regex: search, $options: 'i' } }
        ] }
      ];
      delete query.role;
    }

    const staff = await User.find(query)
      .select('-password')
      .limit(1000)
      .sort({ role: 1, firstName: 1 });  // teacher ก่อน manager (alphabetical)

    sendResponse(res, 200, true, staff, 'Teaching staff retrieved');
  } catch (error) {
    console.error('Get teaching-staff error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// GET /students — List all students
router.get('/students', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { search } = req.query;

    let query = { role: 'student' };

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(query);
    const students = await User.find(query)
      .select('-password')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, students, 'Students retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get students error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// GET / — List all users (Admin/Manager)
router.get('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req.query);
    const { role, search } = req.query;

    let query = {};

    if (role && ['admin', 'manager', 'student', 'teacher'].includes(role)) {
      query.role = role;
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, users, 'Users retrieved', createPaginationObject(page, limit, total));
  } catch (error) {
    console.error('Get users error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// ─── DYNAMIC ROUTES (/:id and its sub-routes) ─────────────────────────────────

// GET /:id — Get single user
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    if (req.user.id !== req.params.id && !['admin', 'manager'].includes(req.user.role)) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    sendResponse(res, 200, true, user.toJSON(), 'User retrieved');
  } catch (error) {
    console.error('Get user error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// PUT /:id — Update user profile
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && !['admin', 'manager'].includes(req.user.role)) {
      return sendResponse(res, 403, false, null, 'Access denied');
    }

    // ── ฟิลด์ที่อนุญาตให้แก้ไข ──
    // อนุญาต: ข้อมูลพื้นฐาน + ข้อมูลที่กรอกตอนสมัคร (ยกเว้น email, password, role, registrationStatus, nationalId)
    const allowedFields = [
      'firstName', 'lastName', 'nickname',
      'phone', 'lineId',
      'age', 'gender',
      'subjects', 'bio', 'grade', 'parentContact', 'guardianName',
      'profileImage',
      'university', 'paymentChannel', 'bankAccountNumber', 'bankAccountName',
      'academicYear',
      // ── ที่อยู่ ──
      'addressDetail', 'moo', 'soi', 'road',
      'subdistrict', 'district', 'province',
      'postalCode', 'country', 'addressNote'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        // อนุญาตให้ตั้งค่าเป็น string ว่างได้ (เพื่อล้างค่า) ยกเว้น firstName/lastName ที่ต้องไม่ว่าง
        if ((field === 'firstName' || field === 'lastName') && !req.body[field]) continue;
        updateData[field] = req.body[field];
      }
    }

    // ตรวจสอบเบอร์โทรซ้ำเมื่อมีการแก้ไข — 1 เบอร์ ต่อ 1 บัญชี
    if (updateData.phone) {
      const normalizedPhone = String(updateData.phone).replace(/[-\s]/g, '');
      updateData.phone = normalizedPhone;
      const phoneOwner = await User.findOne({ phone: normalizedPhone, _id: { $ne: req.params.id } });
      if (phoneOwner) {
        return sendResponse(res, 400, false, null, 'เบอร์โทรนี้ถูกใช้งานในระบบแล้ว');
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    sendResponse(res, 200, true, user.toJSON(), 'User updated');
  } catch (error) {
    console.error('Update user error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// DELETE /:id — Deactivate user (Admin/Manager)
router.delete('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    ).select('-password');

    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    sendResponse(res, 200, true, user.toJSON(), 'User deactivated');
  } catch (error) {
    console.error('Delete user error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// PUT /:id/change-role — Promote teacher→manager or demote manager→teacher (Admin only)
// Rule: Teacher must be registered (registrationStatus='registered') before becoming Manager
router.put('/:id/change-role', authenticateToken, roleCheck(['admin']), async (req, res) => {
  try {
    const { newRole } = req.body;

    if (!newRole) {
      return sendResponse(res, 400, false, null, 'newRole is required');
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return sendResponse(res, 404, false, null, 'User not found');
    }

    // Cannot change anyone to admin role
    if (newRole === 'admin') {
      return sendResponse(res, 403, false, null, 'ไม่สามารถเปลี่ยน role เป็น admin ได้');
    }

    // Cannot change student roles
    if (user.role === 'student') {
      return sendResponse(res, 403, false, null, 'ไม่สามารถเปลี่ยน role ของนักเรียนได้');
    }

    // Only teacher and manager roles can be changed between each other
    if (!['teacher', 'manager'].includes(user.role)) {
      return sendResponse(res, 403, false, null, 'สามารถเปลี่ยน role ได้เฉพาะ teacher และ manager เท่านั้น');
    }

    if (!['teacher', 'manager'].includes(newRole)) {
      return sendResponse(res, 400, false, null, 'newRole ต้องเป็น teacher หรือ manager เท่านั้น');
    }

    // Teacher must be registered (approved by manager) before being promoted to manager
    if (user.role === 'teacher' && newRole === 'manager') {
      if (user.registrationStatus !== 'registered') {
        return sendResponse(res, 403, false, null, 'ครูต้องได้รับการอนุมัติจาก Manager ก่อนจึงจะเลื่อนตำแหน่งเป็น Manager ได้');
      }
    }

    // Use findByIdAndUpdate to avoid password validator on save()
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { role: newRole },
      { new: true, runValidators: false }
    ).select('-password');

    sendResponse(res, 200, true, updated.toJSON(), `เปลี่ยน role เป็น ${newRole} สำเร็จ`);
  } catch (error) {
    console.error('Change user role error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// PUT /:id/approve-teacher — Manager or Admin can approve teacher registration
router.put('/:id/approve-teacher', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    // Validate first (before update)
    const existing = await User.findById(req.params.id).select('role registrationStatus');
    if (!existing) {
      return sendResponse(res, 404, false, null, 'ไม่พบผู้ใช้');
    }
    if (existing.role !== 'teacher') {
      return sendResponse(res, 400, false, null, 'ผู้ใช้นี้ไม่ใช่ครู');
    }
    if (existing.registrationStatus === 'registered') {
      return sendResponse(res, 400, false, null, 'ครูได้รับการอนุมัติแล้ว');
    }

    // Use findByIdAndUpdate to avoid triggering password validator on save()
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      {
        registrationStatus: 'registered',
        approvedBy: req.user.id,
        approvedAt: new Date()
      },
      { new: true, runValidators: false }
    ).select('-password');

    // Notify teacher (non-blocking — don't fail the whole request if notification fails)
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        recipient: updated._id,
        sender: req.user.id,
        type: 'general',
        title: 'การลงทะเบียนครูได้รับการอนุมัติแล้ว',
        message: 'บัญชีครูของคุณได้รับการอนุมัติแล้ว และสามารถใช้งานได้แล้ว',
        relatedId: updated._id
      });
    } catch (notifErr) {
      console.error('Notification error (non-fatal):', notifErr.message);
    }

    sendResponse(res, 200, true, updated.toJSON(), 'อนุมัติครูสำเร็จ');
  } catch (error) {
    console.error('Approve teacher error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// PUT /:id/reject-teacher — Manager/Admin can reject teacher registration
router.put('/:id/reject-teacher', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const existing = await User.findById(req.params.id).select('role _id');
    if (!existing) {
      return sendResponse(res, 404, false, null, 'ไม่พบผู้ใช้');
    }
    if (existing.role !== 'teacher') {
      return sendResponse(res, 400, false, null, 'ผู้ใช้นี้ไม่ใช่ครู');
    }

    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true, runValidators: false }
    ).select('-password');

    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        recipient: updated._id,
        sender: req.user.id,
        type: 'general',
        title: 'การลงทะเบียนครูไม่ได้รับการอนุมัติ',
        message: 'ขออภัย การลงทะเบียนครูของคุณไม่ได้รับการอนุมัติ',
        relatedId: updated._id
      });
    } catch (notifErr) {
      console.error('Notification error (non-fatal):', notifErr.message);
    }

    sendResponse(res, 200, true, updated.toJSON(), 'ปฏิเสธการลงทะเบียนครูสำเร็จ');
  } catch (error) {
    console.error('Reject teacher error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
