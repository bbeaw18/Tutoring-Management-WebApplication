const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const { authenticateToken } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { sendResponse } = require('../utils/helpers');

// GET /api/expenses?month=YYYY-MM — list expenses (admin/manager)
router.get('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { month } = req.query;
    const query = {};
    if (month) query.month = month;
    const expenses = await Expense.find(query).sort({ createdAt: -1 });
    sendResponse(res, 200, true, expenses, 'Expenses retrieved');
  } catch (error) {
    console.error('Get expenses error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// POST /api/expenses — create expense (admin/manager)
router.post('/', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const { description, amount, month, type } = req.body;
    if (!description || !String(description).trim()) {
      return sendResponse(res, 400, false, null, 'description is required');
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 0) {
      return sendResponse(res, 400, false, null, 'amount must be a non-negative number');
    }
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return sendResponse(res, 400, false, null, 'month must be in YYYY-MM format');
    }
    const normalizedType = type === 'income' ? 'income' : 'expense';
    const expense = await Expense.create({
      description: String(description).trim(),
      type: normalizedType,
      amount: numAmount,
      month,
      createdBy: req.user.id
    });
    sendResponse(res, 201, true, expense, 'Expense created');
  } catch (error) {
    console.error('Create expense error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

// DELETE /api/expenses/:id — delete expense (admin/manager)
router.delete('/:id', authenticateToken, roleCheck(['admin', 'manager']), async (req, res) => {
  try {
    const removed = await Expense.findByIdAndDelete(req.params.id);
    if (!removed) {
      return sendResponse(res, 404, false, null, 'Expense not found');
    }
    sendResponse(res, 200, true, null, 'Expense deleted');
  } catch (error) {
    console.error('Delete expense error:', error);
    sendResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
