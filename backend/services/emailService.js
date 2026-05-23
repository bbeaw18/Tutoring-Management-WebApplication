const nodemailer = require('nodemailer');

// ตรวจสอบว่ามีการตั้งค่า SMTP หรือไม่
const isEmailConfigured = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

let transporter = null;

if (isEmailConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

/**
 * จำนวนชั่วโมงสอนจาก startTime/endTime (รองรับข้ามเที่ยงคืน)
 * — สูตรเดียวกับ Schedule.totalDurationMinutes
 */
function durationHours(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60; // ข้ามเที่ยงคืน (เลิกวันถัดไป)
  return mins / 60;
}

/**
 * แปลงชั่วโมง (ทศนิยม) → ข้อความ "X ชั่วโมง Y นาที"
 */
function formatHours(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return `${h} ชั่วโมง${m > 0 ? ` ${m} นาที` : ''}`;
  return `${m} นาที`;
}

/**
 * ส่งอีเมลแจ้งเตือนการนัดสอนไปยังครู (แสดงรายได้ที่จะได้รับ)
 */
async function sendCourseCreatedTeacherEmail({
  recipient, subject, teacherName, studentNames,
  scheduledDate, startTime, endTime,
  courseType, teachingType, gradeLevel, courseName,
  teacherIncomeIndividual, teacherIncomeGroup
}) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(scheduledDate).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const typeLabel = courseType === 'individual' ? 'เดี่ยว' : 'กลุ่ม';
  const hours = durationHours(startTime, endTime);
  const hoursText = formatHours(hours);
  const ratePerHour = courseType === 'individual'
    ? teacherIncomeIndividual
    : teacherIncomeGroup;
  const incomeAmount = ratePerHour > 0 && hours > 0
    ? Math.round(ratePerHour * hours)
    : 0;
  const incomeText = incomeAmount > 0
    ? `฿${incomeAmount.toLocaleString('th-TH')}`
    : 'ยังไม่ระบุ';

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3f80 0%, #3b5fc0 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">📚 นัดสอนใหม่รอการยืนยัน</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">กรุณายืนยันรับการสอนภายใน 24 ชั่วโมง</p>
      </div>

      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">${courseName}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 160px;">📖 วิชา</td><td style="color: #1e293b; font-weight: 600;">${subject}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👨‍🎓 นักเรียน</td><td style="color: #1e293b;">${studentNames.join(', ') || '-'}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">📅 วันที่</td><td style="color: #1e293b; font-weight: 600;">${dateFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">⏰ เวลา</td><td style="color: #1e293b; font-weight: 600;">${startTime} – ${endTime} น.</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👥 ประเภท</td><td style="color: #1e293b;">${typeLabel}</td></tr>
          ${teachingType ? `<tr><td style="padding: 8px 0; color: #64748b;">🎯 ประเภทการสอน</td><td style="color: #1e293b;">${teachingType}</td></tr>` : ''}
          ${gradeLevel ? `<tr><td style="padding: 8px 0; color: #64748b;">🏫 ระดับชั้น</td><td style="color: #1e293b;">${gradeLevel}</td></tr>` : ''}
        </table>
      </div>

      <div style="background: #f0fdf4; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1.5px solid #86efac;">
        <h3 style="margin: 0 0 12px; color: #166534; font-size: 16px;">💰 รายได้ที่คุณจะได้รับ</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #166534;">อัตราสอนเดี่ยว / ชม.</td>
            <td style="color: #15803d; font-weight: 700; text-align: right;">
              ${teacherIncomeIndividual > 0 ? `฿${teacherIncomeIndividual.toLocaleString('th-TH')}` : 'ไม่ระบุ'}
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #166534;">อัตราสอนกลุ่ม / ชม.</td>
            <td style="color: #15803d; font-weight: 700; text-align: right;">
              ${teacherIncomeGroup > 0 ? `฿${teacherIncomeGroup.toLocaleString('th-TH')}` : 'ไม่ระบุ'}
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #166534;">จำนวนชั่วโมงสอน</td>
            <td style="color: #15803d; font-weight: 700; text-align: right;">${hoursText}</td>
          </tr>
          <tr style="border-top: 1.5px solid #86efac;">
            <td style="padding: 10px 0 0; color: #14532d; font-weight: 700; font-size: 15px;">
              รายได้ครั้งนี้ (${typeLabel})
              ${ratePerHour > 0 && hours > 0 ? `<br><span style="font-weight: 400; font-size: 12px; color: #166534;">฿${ratePerHour.toLocaleString('th-TH')}/ชม. × ${hoursText}</span>` : ''}
            </td>
            <td style="padding: 10px 0 0; color: #14532d; font-weight: 800; font-size: 20px; text-align: right; vertical-align: top;">${incomeText}</td>
          </tr>
        </table>
        <p style="margin: 10px 0 0; color: #166534; font-size: 12px;">* รายได้จริงคำนวณหลังจากนักเรียนเช็คชื่อเรียบร้อยแล้ว</p>
      </div>

      <div style="background: #fff7ed; border-radius: 12px; padding: 16px; border-left: 4px solid #f97316;">
        <p style="margin: 0; color: #9a3412; font-size: 14px;">⚠️ กรุณาเข้าสู่ระบบ Know More Sci เพื่อยืนยันหรือปฏิเสธนัดสอนนี้ภายใน 24 ชั่วโมง</p>
      </div>

      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: recipient.email,
      subject: `[Know More Sci] 📚 นัดสอนใหม่: ${courseName} — ${dateFormatted}`,
      html
    });
    return { email: recipient.email, success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมลครูไปยัง ${recipient.email} ล้มเหลว:`, err.message);
    return { email: recipient.email, success: false, error: err.message };
  }
}

/**
 * ส่งอีเมลแจ้งเตือนการนัดสอนไปยังนักเรียน (แสดงราคาที่ต้องจ่าย)
 */
async function sendCourseCreatedStudentEmail({
  recipients, subject, teacherName, studentNames,
  scheduledDate, startTime, endTime,
  courseType, teachingType, gradeLevel, courseName,
  coursePrice
}) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(scheduledDate).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const typeLabel = courseType === 'individual' ? 'เดี่ยว' : 'กลุ่ม';
  const hours = durationHours(startTime, endTime);
  const hoursText = formatHours(hours);
  const totalPrice = coursePrice > 0 && hours > 0
    ? Math.round(coursePrice * hours)
    : 0;
  const priceText = totalPrice > 0
    ? `฿${totalPrice.toLocaleString('th-TH')}`
    : 'ไม่มีค่าใช้จ่าย';

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">🎓 มีการนัดสอนใหม่</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">กรุณาตรวจสอบรายละเอียดและยืนยันการเข้าเรียน</p>
      </div>

      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">${courseName}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 160px;">📖 วิชา</td><td style="color: #1e293b; font-weight: 600;">${subject}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👨‍🏫 ครูผู้สอน</td><td style="color: #1e293b; font-weight: 600;">${teacherName}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👥 เพื่อนร่วมคลาส</td><td style="color: #1e293b;">${studentNames.join(', ') || '-'}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">📅 วันที่</td><td style="color: #1e293b; font-weight: 600;">${dateFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">⏰ เวลา</td><td style="color: #1e293b; font-weight: 600;">${startTime} – ${endTime} น.</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👥 ประเภท</td><td style="color: #1e293b;">${typeLabel}</td></tr>
          ${teachingType ? `<tr><td style="padding: 8px 0; color: #64748b;">🎯 ประเภทการสอน</td><td style="color: #1e293b;">${teachingType}</td></tr>` : ''}
          ${gradeLevel ? `<tr><td style="padding: 8px 0; color: #64748b;">🏫 ระดับชั้น</td><td style="color: #1e293b;">${gradeLevel}</td></tr>` : ''}
        </table>
      </div>

      <div style="background: #fef3c7; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1.5px solid #fbbf24;">
        <h3 style="margin: 0 0 8px; color: #78350f; font-size: 16px;">💰 ค่าเรียนที่ต้องชำระ</h3>
        <p style="margin: 0; color: #78350f; font-size: 28px; font-weight: 800;">${priceText}</p>
        ${totalPrice > 0
          ? `<p style="margin: 6px 0 0; color: #92400e; font-size: 13px;">฿${coursePrice.toLocaleString('th-TH')}/ชม. × ${hoursText}</p>
             <p style="margin: 8px 0 0; color: #92400e; font-size: 13px;">กรุณาชำระเงินผ่านระบบ Know More Sci หลังยืนยันการเข้าเรียน</p>`
          : `<p style="margin: 8px 0 0; color: #92400e; font-size: 13px;">การนัดสอนครั้งนี้ไม่มีค่าใช้จ่าย</p>`
        }
      </div>

      <div style="background: #fff7ed; border-radius: 12px; padding: 16px; border-left: 4px solid #f97316;">
        <p style="margin: 0; color: #9a3412; font-size: 14px;">⚠️ กรุณาเข้าสู่ระบบ Know More Sci เพื่อยืนยันการเข้าเรียน</p>
      </div>

      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: recipient.email,
        subject: `[Know More Sci] 🎓 นัดสอนใหม่: ${courseName} — ${dateFormatted}`,
        html
      });
      results.push({ email: recipient.email, success: true });
    } catch (err) {
      console.error(`[EmailService] ส่งอีเมลนักเรียนไปยัง ${recipient.email} ล้มเหลว:`, err.message);
      results.push({ email: recipient.email, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * ส่งอีเมลแจ้งเตือนเมื่อครูยืนยันการสอน
 */
async function sendCourseAcceptedEmail({ recipients, courseName, subject, teacherName, scheduledDate, startTime, endTime }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(scheduledDate).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">✅ ยืนยันการนัดสอนแล้ว</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${teacherName} ยืนยันรับการสอนแล้ว</p>
      </div>

      <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0;">${courseName}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 140px;">📖 วิชา</td><td style="color: #1e293b; font-weight: 600;">${subject}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👨‍🏫 ครูผู้สอน</td><td style="color: #1e293b; font-weight: 600;">${teacherName}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">📅 วันที่</td><td style="color: #1e293b; font-weight: 600;">${dateFormatted}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">⏰ เวลา</td><td style="color: #1e293b; font-weight: 600;">${startTime} – ${endTime} น.</td></tr>
        </table>
        <div style="background: #f0fdf4; border-radius: 12px; padding: 16px; margin-top: 16px;">
          <p style="margin: 0; color: #166534;">📅 นัดสอนนี้ถูกเพิ่มในปฏิทินของคุณแล้ว</p>
        </div>
      </div>

      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">
        อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ
      </p>
    </div>
  `;

  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: recipient.email,
        subject: `[Know More Sci] ✅ ยืนยันนัดสอน: ${courseName}`,
        html
      });
      results.push({ email: recipient.email, success: true });
    } catch (err) {
      console.error(`[EmailService] ส่งอีเมลไปยัง ${recipient.email} ล้มเหลว:`, err.message);
      results.push({ email: recipient.email, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * ส่งอีเมลแจ้งนักเรียนเมื่อมีการสร้างตารางนัดสอน
 * (แสดง: ชื่อคลาส, ครู, สมาชิก, เวลา, ชม./นาที, ราคาคอร์ส)
 */
async function sendScheduleCreatedEmail({
  recipients,
  teacherName,
  courseName,
  subject,
  members,
  date,
  startTime,
  endTime,
  totalDurationMinutes,
  coursePrice
}) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(date).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const hours = Math.floor(totalDurationMinutes / 60);
  const mins = totalDurationMinutes % 60;
  const durationText = hours > 0
    ? `${hours} ชั่วโมง ${mins > 0 ? mins + ' นาที' : ''}`
    : `${mins} นาที`;

  const membersHtml = members.map(m => `<li style="padding: 4px 0; color: #1e293b;">${m}</li>`).join('');
  const courseHours = (Number(totalDurationMinutes) || 0) / 60;
  const totalPrice = coursePrice > 0 && courseHours > 0
    ? Math.round(coursePrice * courseHours)
    : 0;
  const priceText = totalPrice > 0
    ? `฿${totalPrice.toLocaleString('th-TH')}`
    : 'ไม่มีค่าใช้จ่าย';

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">📅 นัดสอนใหม่</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">กรุณาตรวจสอบรายละเอียดและยืนยันการเข้าเรียน</p>
      </div>

      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">${courseName}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 10px 0; color: #64748b; width: 160px; vertical-align: top;">👨‍🏫 ครูผู้สอน</td><td style="color: #1e293b; font-weight: 600;">${teacherName}</td></tr>
          <tr><td style="padding: 10px 0; color: #64748b; vertical-align: top;">📖 วิชา</td><td style="color: #1e293b;">${subject || '-'}</td></tr>
          <tr><td style="padding: 10px 0; color: #64748b; vertical-align: top;">📅 วันที่</td><td style="color: #1e293b; font-weight: 600;">${dateFormatted}</td></tr>
          <tr><td style="padding: 10px 0; color: #64748b; vertical-align: top;">⏰ เวลา</td><td style="color: #1e293b; font-weight: 600;">${startTime} – ${endTime} น.</td></tr>
          <tr><td style="padding: 10px 0; color: #64748b; vertical-align: top;">⏱️ ระยะเวลา</td><td style="color: #1e293b;">${durationText}</td></tr>
          <tr>
            <td style="padding: 10px 0; color: #64748b; vertical-align: top;">👥 สมาชิกในคลาส</td>
            <td><ul style="margin: 0; padding-left: 20px;">${membersHtml}</ul></td>
          </tr>
        </table>
      </div>

      <div style="background: #fef3c7; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 24px;">💰</span>
          <div>
            <p style="margin: 0; color: #92400e; font-size: 13px;">ค่าเรียนที่ต้องชำระ</p>
            <p style="margin: 4px 0 0; color: #78350f; font-size: 20px; font-weight: 700;">${priceText}</p>
            ${totalPrice > 0 ? `<p style="margin: 4px 0 0; color: #92400e; font-size: 12px;">฿${coursePrice.toLocaleString('th-TH')}/ชม. × ${durationText}</p>` : ''}
          </div>
        </div>
      </div>

      <div style="background: #fff7ed; border-radius: 12px; padding: 16px; border-left: 4px solid #f97316;">
        <p style="margin: 0; color: #9a3412; font-size: 14px;">⚠️ กรุณาเข้าสู่ระบบ Know More Sci เพื่อยืนยันการเข้าเรียน</p>
      </div>

      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">
        อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ
      </p>
    </div>
  `;

  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: recipient.email,
        subject: `[Know More Sci] 📅 นัดสอนใหม่: ${courseName} — ${dateFormatted}`,
        html
      });
      results.push({ email: recipient.email, success: true });
    } catch (err) {
      console.error(`[EmailService] ส่งอีเมลไปยัง ${recipient.email} ล้มเหลว:`, err.message);
      results.push({ email: recipient.email, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * ส่งอีเมลเมื่อทุกฝ่ายยืนยันและตารางสอน Active แล้ว
 */
async function sendScheduleConfirmedEmail({ recipients, courseName, date, startTime, endTime }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(date).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">✅ ยืนยันครบแล้ว!</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">ตารางสอนถูกเปิดใช้งานในปฏิทินแล้ว</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0;">${courseName}</h2>
        <p style="color: #475569;">📅 ${dateFormatted} เวลา ${startTime} – ${endTime} น.</p>
        <div style="background: #f0fdf4; border-radius: 12px; padding: 16px; margin-top: 16px;">
          <p style="margin: 0; color: #166534;">🗓️ นัดสอนนี้ถูกเพิ่มในปฏิทินของคุณเรียบร้อยแล้ว</p>
        </div>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: recipient.email,
        subject: `[Know More Sci] ✅ ยืนยันครบแล้ว: ${courseName}`,
        html
      });
      results.push({ email: recipient.email, success: true });
    } catch (err) {
      console.error(`[EmailService] ส่งอีเมลไปยัง ${recipient.email} ล้มเหลว:`, err.message);
      results.push({ email: recipient.email, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * ส่งอีเมลแจ้งเตือนค้างชำระ (cron job วันที่ 3 ของเดือน)
 */
async function sendPaymentReminderEmail({ studentEmail, studentName, unpaidItems, totalAmount }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const itemsHtml = unpaidItems.map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #1e293b;">${item.courseName}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #475569;">${item.dateText}</td>
      <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: #dc2626; font-weight: 600; text-align: right;">฿${item.amount.toLocaleString('th-TH')}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">⚠️ แจ้งเตือนค้างชำระ</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">กรุณาชำระเงินโดยด่วน</p>
      </div>

      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <p style="color: #475569; margin-top: 0;">เรียน <strong>${studentName}</strong></p>
        <p style="color: #475569;">คุณมียอดค้างชำระสำหรับคลาสเรียนดังต่อไปนี้ กรุณาชำระภายในวันที่ 3 ของเดือน</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="padding: 10px; text-align: left; color: #64748b; font-size: 13px;">คลาส</th>
              <th style="padding: 10px; text-align: left; color: #64748b; font-size: 13px;">วันที่</th>
              <th style="padding: 10px; text-align: right; color: #64748b; font-size: 13px;">ยอด</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr style="background: #fef2f2;">
              <td colspan="2" style="padding: 12px 10px; font-weight: 700; color: #1e293b;">ยอดรวมที่ต้องชำระ</td>
              <td style="padding: 12px 10px; font-weight: 700; color: #dc2626; font-size: 18px; text-align: right;">฿${totalAmount.toLocaleString('th-TH')}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style="background: #fef2f2; border-radius: 12px; padding: 16px; border-left: 4px solid #ef4444;">
        <p style="margin: 0; color: #991b1b; font-size: 14px;">🚨 หากไม่ชำระภายในวันที่ 3 อาจถูกระงับการเข้าเรียนชั่วคราว</p>
      </div>

      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">
        อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: studentEmail,
      subject: `[Know More Sci] ⚠️ แจ้งเตือนค้างชำระ — ยอดรวม ฿${totalAmount.toLocaleString('th-TH')}`,
      html
    });
    return { success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมลแจ้งเตือนชำระเงินล้มเหลว:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * ส่งอีเมลแจ้งเตือนเมื่อมีการแก้ไขรายละเอียดนัดสอน — ส่งหาครู (แสดงรายได้)
 */
async function sendScheduleEditedTeacherEmail({
  recipient, courseName, subject, teacherName,
  oldDate, oldStartTime, oldEndTime,
  newDate, newStartTime, newEndTime,
  courseType, teacherIncomeIndividual, teacherIncomeGroup
}) {
  if (!isEmailConfigured || !transporter) return { skipped: true };

  const fmtDate = (d) => new Date(d).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const oldDateFmt = fmtDate(oldDate);
  const newDateFmt = fmtDate(newDate);
  const typeLabel = courseType === 'individual' ? 'เดี่ยว' : 'กลุ่ม';
  const hours = durationHours(newStartTime, newEndTime);
  const hoursText = formatHours(hours);
  const ratePerHour = courseType === 'individual' ? teacherIncomeIndividual : teacherIncomeGroup;
  const incomeAmount = ratePerHour > 0 && hours > 0 ? Math.round(ratePerHour * hours) : 0;
  const incomeText = incomeAmount > 0 ? `฿${incomeAmount.toLocaleString('th-TH')}` : 'ยังไม่ระบุ';

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">✏️ รายละเอียดนัดสอนถูกแก้ไข</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${courseName} — กรุณาตรวจสอบเวลาใหม่</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">${courseName}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 160px;">📖 วิชา</td><td style="color: #1e293b; font-weight: 600;">${subject}</td></tr>
        </table>
        <div style="display: flex; gap: 16px; margin-top: 16px;">
          <div style="flex: 1; background: #fee2e2; border-radius: 10px; padding: 14px;">
            <div style="font-size: 12px; color: #dc2626; font-weight: 700; margin-bottom: 6px;">⏪ เดิม</div>
            <div style="color: #7f1d1d; font-size: 13px;">${oldDateFmt}</div>
            <div style="color: #7f1d1d; font-size: 15px; font-weight: 700;">${oldStartTime} – ${oldEndTime}</div>
          </div>
          <div style="flex: 1; background: #d1fae5; border-radius: 10px; padding: 14px;">
            <div style="font-size: 12px; color: #059669; font-weight: 700; margin-bottom: 6px;">⏩ ใหม่</div>
            <div style="color: #065f46; font-size: 13px;">${newDateFmt}</div>
            <div style="color: #065f46; font-size: 15px; font-weight: 700;">${newStartTime} – ${newEndTime}</div>
          </div>
        </div>
      </div>
      <div style="background: #f0fdf4; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1.5px solid #86efac;">
        <h3 style="margin: 0 0 8px; color: #166534; font-size: 15px;">💰 รายได้ที่คุณจะได้รับ (${typeLabel})</h3>
        <p style="margin: 0; color: #14532d; font-size: 22px; font-weight: 800;">${incomeText}</p>
        ${ratePerHour > 0 && hours > 0 ? `<p style="margin: 6px 0 0; color: #166534; font-size: 12px;">฿${ratePerHour.toLocaleString('th-TH')}/ชม. × ${hoursText}</p>` : ''}
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: recipient.email,
      subject: `[Know More Sci] ✏️ แก้ไขนัดสอน: ${courseName} — ${newDateFmt}`,
      html
    });
    return { email: recipient.email, success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมลแก้ไขนัดสอน(ครู) ล้มเหลว:`, err.message);
    return { email: recipient.email, success: false, error: err.message };
  }
}

/**
 * ส่งอีเมลแจ้งเตือนเมื่อมีการแก้ไขรายละเอียดนัดสอน — ส่งหานักเรียน (แสดงราคา)
 */
async function sendScheduleEditedStudentEmail({
  recipients, courseName, subject, teacherName,
  oldDate, oldStartTime, oldEndTime,
  newDate, newStartTime, newEndTime,
  coursePrice
}) {
  if (!isEmailConfigured || !transporter) return { skipped: true };

  const fmtDate = (d) => new Date(d).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const oldDateFmt = fmtDate(oldDate);
  const newDateFmt = fmtDate(newDate);
  const hours = durationHours(newStartTime, newEndTime);
  const hoursText = formatHours(hours);
  const totalPrice = coursePrice > 0 && hours > 0 ? Math.round(coursePrice * hours) : 0;
  const priceText = totalPrice > 0 ? `฿${totalPrice.toLocaleString('th-TH')}` : 'ไม่มีค่าใช้จ่าย';

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">✏️ นัดสอนถูกแก้ไข</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${courseName} — กรุณาตรวจสอบเวลาใหม่</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">${courseName}</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #64748b; width: 160px;">📖 วิชา</td><td style="color: #1e293b; font-weight: 600;">${subject}</td></tr>
          <tr><td style="padding: 8px 0; color: #64748b;">👨‍🏫 ครูผู้สอน</td><td style="color: #1e293b; font-weight: 600;">${teacherName}</td></tr>
        </table>
        <div style="display: flex; gap: 16px; margin-top: 16px;">
          <div style="flex: 1; background: #fee2e2; border-radius: 10px; padding: 14px;">
            <div style="font-size: 12px; color: #dc2626; font-weight: 700; margin-bottom: 6px;">⏪ เดิม</div>
            <div style="color: #7f1d1d; font-size: 13px;">${oldDateFmt}</div>
            <div style="color: #7f1d1d; font-size: 15px; font-weight: 700;">${oldStartTime} – ${oldEndTime}</div>
          </div>
          <div style="flex: 1; background: #d1fae5; border-radius: 10px; padding: 14px;">
            <div style="font-size: 12px; color: #059669; font-weight: 700; margin-bottom: 6px;">⏩ ใหม่</div>
            <div style="color: #065f46; font-size: 13px;">${newDateFmt}</div>
            <div style="color: #065f46; font-size: 15px; font-weight: 700;">${newStartTime} – ${newEndTime}</div>
          </div>
        </div>
      </div>
      <div style="background: #fef3c7; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1.5px solid #fbbf24;">
        <h3 style="margin: 0 0 8px; color: #78350f; font-size: 15px;">💰 ค่าเรียนที่ต้องชำระ</h3>
        <p style="margin: 0; color: #78350f; font-size: 22px; font-weight: 800;">${priceText}</p>
        ${totalPrice > 0 ? `<p style="margin: 6px 0 0; color: #92400e; font-size: 12px;">฿${coursePrice.toLocaleString('th-TH')}/ชม. × ${hoursText}</p>` : ''}
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  const results = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: recipient.email,
        subject: `[Know More Sci] ✏️ แก้ไขนัดสอน: ${courseName} — ${newDateFmt}`,
        html
      });
      results.push({ email: recipient.email, success: true });
    } catch (err) {
      results.push({ email: recipient.email, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * ส่งอีเมลแจ้งเตือนเมื่อมีการย้ายเวลานัดสอน (drag reschedule) — ส่งหาครูและนักเรียน
 */
async function sendScheduleRescheduledEmail({
  teacherRecipient, studentRecipients,
  courseName, teacherName,
  oldDate, oldStartTime, oldEndTime,
  newDate, newStartTime, newEndTime
}) {
  if (!isEmailConfigured || !transporter) return { skipped: true };

  const fmtDate = (d) => new Date(d).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const oldDateFmt = fmtDate(oldDate);
  const newDateFmt = fmtDate(newDate);

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">🕐 เปลี่ยนเวลานัดสอน</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${courseName} — ผู้จัดการย้ายเวลาการสอน</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <h2 style="color: #1e293b; margin-top: 0; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">${courseName}</h2>
        <p style="color: #64748b; margin: 0 0 16px;">👨‍🏫 ครูผู้สอน: <strong style="color: #1e293b;">${teacherName}</strong></p>
        <div style="display: flex; gap: 16px;">
          <div style="flex: 1; background: #fee2e2; border-radius: 10px; padding: 14px;">
            <div style="font-size: 12px; color: #dc2626; font-weight: 700; margin-bottom: 6px;">⏪ เวลาเดิม</div>
            <div style="color: #7f1d1d; font-size: 13px;">${oldDateFmt}</div>
            <div style="color: #7f1d1d; font-size: 15px; font-weight: 700;">${oldStartTime} – ${oldEndTime}</div>
          </div>
          <div style="flex: 1; background: #d1fae5; border-radius: 10px; padding: 14px;">
            <div style="font-size: 12px; color: #059669; font-weight: 700; margin-bottom: 6px;">⏩ เวลาใหม่</div>
            <div style="color: #065f46; font-size: 13px;">${newDateFmt}</div>
            <div style="color: #065f46; font-size: 15px; font-weight: 700;">${newStartTime} – ${newEndTime}</div>
          </div>
        </div>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  const allRecipients = [
    ...(teacherRecipient ? [teacherRecipient] : []),
    ...(studentRecipients || [])
  ];
  const results = [];
  for (const recipient of allRecipients) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: recipient.email,
        subject: `[Know More Sci] 🕐 เปลี่ยนเวลานัดสอน: ${courseName} → ${newDateFmt} ${newStartTime}`,
        html
      });
      results.push({ email: recipient.email, success: true });
    } catch (err) {
      results.push({ email: recipient.email, success: false, error: err.message });
    }
  }
  return results;
}

// ── sendManagerClassCompletedEmail — แจ้ง manager ว่าคลาสรอยืนยัน ─────────
async function sendManagerClassCompletedEmail({
  managerEmails, teacherName, subjectName, dateText, timeText,
  attendanceCount, totalStudents, teacherIncome, coursePrice
}) {
  if (!isEmailConfigured()) return;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);padding:28px 32px">
        <h1 style="color:white;margin:0;font-size:22px">📋 คลาสเสร็จสิ้น — รอยืนยัน</h1>
        <p style="color:#e0d9ff;margin:8px 0 0;font-size:14px">กรุณาตรวจสอบและยืนยันสำเร็จการสอนในระบบ</p>
      </div>
      <div style="padding:28px 32px;background:#fafafa">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#64748b;width:40%">วิชา</td><td style="padding:8px 0;font-weight:600">${subjectName || '-'}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">ครูผู้สอน</td><td style="padding:8px 0;font-weight:600">${teacherName}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">วันที่</td><td style="padding:8px 0">${dateText}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">เวลา</td><td style="padding:8px 0">${timeText}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">นักเรียนเช็คชื่อ</td><td style="padding:8px 0"><strong>${attendanceCount}</strong>/${totalStudents} คน</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">รายได้ครู (ประมาณ)</td><td style="padding:8px 0;color:#16a34a;font-weight:700">฿${(teacherIncome || 0).toLocaleString('th-TH')}</td></tr>
          ${(coursePrice > 0) ? `<tr><td style="padding:8px 0;color:#64748b">ค่าเรียน/คน</td><td style="padding:8px 0;color:#d97706;font-weight:700">฿${coursePrice.toLocaleString('th-TH')}</td></tr>` : ''}
        </table>
        <div style="margin-top:24px;padding:16px;background:#f0fdf4;border-radius:8px;border-left:4px solid #16a34a;font-size:13px;color:#166534">
          เข้าสู่ระบบ → <strong>ประวัติการสอน</strong> → กด <strong>ยืนยันสำเร็จ</strong> เพื่อบันทึกรายได้ครูและชั่วโมงเรียนนักเรียน
        </div>
      </div>
    </div>`;
  const results = [];
  for (const email of managerEmails) {
    try {
      await transporter.sendMail({
        from: `"Know More Sci" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `[Know More Sci] 📋 คลาส${subjectName ? ' ' + subjectName : ''} เสร็จสิ้น — รอยืนยัน`,
        html
      });
      results.push({ email, success: true });
    } catch (err) {
      results.push({ email, success: false, error: err.message });
    }
  }
  return results;
}

/**
 * ส่งอีเมลแจ้งครูเมื่อนักเรียนยืนยันการนัดเรียน
 */
async function sendStudentBookingConfirmedEmail({ teacherEmail, teacherName, studentName, courseName, date, startTime, endTime }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(date).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3f80 0%, #0d2050 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">📅 นักเรียนยืนยันการนัดเรียน</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">มีนักเรียนยืนยันเข้าร่วมคลาสของคุณ</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">สวัสดีครู <strong>${teacherName}</strong>,</p>
        <p style="color: #475569;">นักเรียน <strong style="color: #1e3f80;">${studentName}</strong> ได้ยืนยันการนัดเรียนดังนี้:</p>
        <div style="background: #eff6ff; border-radius: 12px; padding: 16px; margin: 16px 0;">
          <p style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #1e293b;">📚 ${courseName}</p>
          <p style="margin: 0; color: #475569;">📅 ${dateFormatted}</p>
          <p style="margin: 4px 0 0; color: #475569;">⏰ ${startTime} – ${endTime} น.</p>
        </div>
        <div style="background: #f0fdf4; border-radius: 12px; padding: 12px 16px; margin-top: 12px;">
          <p style="margin: 0; color: #166534; font-size: 13px;">✅ นักเรียนพร้อมเข้าเรียนตามนัดที่กำหนด</p>
        </div>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: teacherEmail,
      subject: `[Know More Sci] 📅 ${studentName} ยืนยันนัดเรียน: ${courseName}`,
      html
    });
    return { email: teacherEmail, success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมลไปยัง ${teacherEmail} ล้มเหลว:`, err.message);
    return { email: teacherEmail, success: false, error: err.message };
  }
}

async function sendVideoLinkEmail({ studentEmail, studentName, teacherName, courseName, date, startTime, endTime, videoLink }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(date).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">🎬 ลิ้งค์ VDO Online</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">คุณครูได้แชร์ลิ้งค์วิดีโอสำหรับคลาสของคุณ</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">สวัสดี <strong>${studentName}</strong>,</p>
        <p style="color: #475569;">ครู <strong>${teacherName}</strong> ได้ส่งลิ้งค์วิดีโอสำหรับคลาส:</p>
        <div style="background: #f5f3ff; border-radius: 12px; padding: 16px; margin: 16px 0; border-left: 4px solid #7c3aed;">
          <p style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #1e293b;">📚 ${courseName}</p>
          <p style="margin: 0; color: #475569;">📅 ${dateFormatted}</p>
          <p style="margin: 4px 0 0; color: #475569;">⏰ ${startTime} – ${endTime} น.</p>
        </div>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${videoLink}" target="_blank"
             style="display: inline-block; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: white; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-size: 16px; font-weight: 700; box-shadow: 0 4px 16px rgba(124,58,237,0.35);">
            🎬 ดูวิดีโอ
          </a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; word-break: break-all;">ลิ้งค์: <a href="${videoLink}" style="color: #7c3aed;">${videoLink}</a></p>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: studentEmail,
      subject: `[Know More Sci] 🎬 ลิ้งค์ VDO: ${courseName}`,
      html
    });
    return { email: studentEmail, success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมลไปยัง ${studentEmail} ล้มเหลว:`, err.message);
    return { email: studentEmail, success: false, error: err.message };
  }
}

/**
 * ส่งอีเมล reset password — ลิงก์ใช้ได้ภายใน 1 ชม.
 */
async function sendPasswordResetEmail({ email, userName, resetLink, expiresInMinutes = 60 }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล reset password');
    return { skipped: true };
  }

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3f80 0%, #3b5fc0 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">🔐 ตั้งรหัสผ่านใหม่</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">คำขอตั้งรหัสผ่านใหม่สำหรับบัญชี Know More Sci</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">สวัสดี <strong>${userName || 'ผู้ใช้งาน'}</strong>,</p>
        <p style="color: #475569; line-height: 1.7;">
          เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีอีเมล <strong>${email}</strong><br>
          คลิกปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์ใช้ได้ ${expiresInMinutes} นาที)
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${resetLink}" target="_blank"
             style="display: inline-block; background: linear-gradient(135deg, #1e3f80, #3b5fc0); color: white; padding: 14px 36px; border-radius: 12px; text-decoration: none; font-size: 16px; font-weight: 700; box-shadow: 0 4px 16px rgba(30,63,128,0.35);">
            🔑 ตั้งรหัสผ่านใหม่
          </a>
        </div>
        <p style="font-size: 12px; color: #94a3b8; word-break: break-all;">
          หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br>
          <a href="${resetLink}" style="color: #1e3f80;">${resetLink}</a>
        </p>
        <div style="background: #fff7ed; border-radius: 12px; padding: 14px 16px; margin-top: 20px; border-left: 4px solid #f97316;">
          <p style="margin: 0; color: #9a3412; font-size: 13px;">
            ⚠️ หากคุณไม่ได้ขอเปลี่ยนรหัสผ่าน โปรดเพิกเฉยอีเมลนี้ — รหัสผ่านเดิมจะยังคงใช้งานได้ตามปกติ
          </p>
        </div>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `[Know More Sci] 🔐 คำขอตั้งรหัสผ่านใหม่`,
      html
    });
    return { email, success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมล reset password ไปยัง ${email} ล้มเหลว:`, err.message);
    return { email, success: false, error: err.message };
  }
}

async function sendStudentBookingDeclinedEmail({ teacherEmail, teacherName, studentName, courseName, date, startTime, endTime }) {
  if (!isEmailConfigured || !transporter) {
    console.log('[EmailService] SMTP ไม่ได้ตั้งค่า — ข้ามการส่งอีเมล');
    return { skipped: true };
  }

  const dateFormatted = new Date(date).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = `
    <div style="font-family: 'Sarabun', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
      <div style="background: linear-gradient(135deg, #64748b 0%, #475569 100%); border-radius: 16px; padding: 32px; text-align: center; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 24px;">❌ นักเรียนปฏิเสธการนัดเรียน</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">นักเรียนได้ยกเลิกการเข้าร่วมคลาสนี้</p>
      </div>
      <div style="background: white; border-radius: 16px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
        <p style="color: #1e293b; font-size: 16px; margin-top: 0;">สวัสดีครู <strong>${teacherName}</strong>,</p>
        <p style="color: #475569;">นักเรียน <strong style="color: #dc2626;">${studentName}</strong> ได้ปฏิเสธการนัดเรียนดังนี้:</p>
        <div style="background: #fef2f2; border-radius: 12px; padding: 16px; margin: 16px 0; border-left: 4px solid #ef4444;">
          <p style="margin: 0 0 6px; font-size: 15px; font-weight: 700; color: #1e293b;">📚 ${courseName}</p>
          <p style="margin: 0; color: #475569;">📅 ${dateFormatted}</p>
          <p style="margin: 4px 0 0; color: #475569;">⏰ ${startTime} – ${endTime} น.</p>
        </div>
        <div style="background: #fef9f0; border-radius: 12px; padding: 12px 16px; margin-top: 12px;">
          <p style="margin: 0; color: #92400e; font-size: 13px;">⚠️ กรุณาติดต่อนักเรียนเพื่อนัดเวลาใหม่หากจำเป็น</p>
        </div>
      </div>
      <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 24px;">อีเมลนี้ส่งจากระบบ Know More Sci โดยอัตโนมัติ</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Know More Sci" <${process.env.SMTP_USER}>`,
      to: teacherEmail,
      subject: `[Know More Sci] ❌ ${studentName} ปฏิเสธนัดเรียน: ${courseName}`,
      html
    });
    return { email: teacherEmail, success: true };
  } catch (err) {
    console.error(`[EmailService] ส่งอีเมลไปยัง ${teacherEmail} ล้มเหลว:`, err.message);
    return { email: teacherEmail, success: false, error: err.message };
  }
}

module.exports = {
  sendCourseCreatedTeacherEmail,
  sendCourseCreatedStudentEmail,
  sendCourseAcceptedEmail,
  sendScheduleCreatedEmail,
  sendScheduleConfirmedEmail,
  sendPaymentReminderEmail,
  sendScheduleEditedTeacherEmail,
  sendScheduleEditedStudentEmail,
  sendScheduleRescheduledEmail,
  sendManagerClassCompletedEmail,
  sendStudentBookingConfirmedEmail,
  sendStudentBookingDeclinedEmail,
  sendVideoLinkEmail,
  sendPasswordResetEmail,
  isEmailConfigured
};
