const User = require('../models/User');
const emailService = require('./emailService');
const { getOverdueTuition, thaiMonth, total } = require('./tuitionService');

async function runPaymentReminderJob(now = new Date()) {
  console.log('[Cron] เริ่ม payment reminder job...');
  const round = thaiMonth(now);
  try {
    const students = await User.find({ role: 'student', isActive: true });
    for (const student of students) {
      const overdue = await getOverdueTuition(student._id, round);
      if (!overdue.length) continue;
      await emailService.sendPaymentReminderEmail({
        studentEmail: student.email,
        studentName: `${student.firstName} ${student.lastName}`,
        unpaidItems: overdue.map(row => ({
          courseName: row.courseName,
          dateText: new Date(row.date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }),
          amount: row.amount
        })),
        totalAmount: total(overdue)
      });
      console.log(`[Cron] ส่งแจ้งเตือนชำระเงินไปยัง ${student.email} (${overdue.length} รายการ)`);
    }
  } catch (error) {
    console.error('[Cron] Payment reminder error:', error);
  }
}

module.exports = { runPaymentReminderJob };
