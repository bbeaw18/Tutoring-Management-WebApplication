const dns = require('dns').promises;

// ── Disposable / temporary email domain blocklist ────────────────────────────
// รายการนี้ครอบคลุม service ยอดนิยมที่ใช้สร้าง email ชั่วคราว
// เพิ่ม domain ใหม่ได้ตามต้องการ (production แนะนำใช้ list จาก
// https://github.com/disposable-email-domains/disposable-email-domains)
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com',
  'mailinator.com', 'mailinator.net', 'mailinator2.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'guerrillamail.de', 'sharklasers.com',
  'grr.la', 'spam4.me',
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com',
  'trashmail.com', 'trashmail.net', 'trashmail.io',
  'yopmail.com', 'yopmail.net', 'yopmail.fr',
  'throwaway.email', 'throwawaymail.com',
  'maildrop.cc', 'getnada.com', 'nada.email',
  'dispostable.com', 'fakeinbox.com', 'fakemail.net',
  'mintemail.com', 'mailcatch.com', 'tempinbox.com',
  'mailnesia.com', 'mohmal.com', 'spambox.us',
  'mytrashmail.com', 'mt2015.com', 'mt2014.com',
  'inboxalias.com', 'inboxbear.com',
  'emailondeck.com', 'emailtemporanea.net',
  'mailtemp.info', 'mail-temporaire.fr',
  'tmpmail.org', 'tmpmail.net', 'mvrht.net',
  'discard.email', 'discardmail.com',
  'cuvox.de', 'rhyta.com', 'jourrapide.com',
  'armyspy.com', 'einrot.com', 'fleckens.hu', 'gustr.com',
  'teleworm.us', 'superrito.com', 'dayrep.com'
]);

/**
 * ตรวจสอบว่า domain ของ email สามารถรับเมลได้จริง
 *  1) format check
 *  2) reject disposable domains
 *  3) DNS MX lookup
 *
 * หมายเหตุ: ตรวจได้แค่ระดับ domain ไม่ได้ตรวจว่า mailbox มีจริง
 * (กัน typo ระดับ domain เช่น "gmial.com" — แต่กัน user-part typo ไม่ได้)
 */
async function verifyEmailDomain(email) {
  if (!email || typeof email !== 'string') {
    return { ok: false, reason: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }

  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex < 1 || atIndex === trimmed.length - 1) {
    return { ok: false, reason: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }

  const domain = trimmed.slice(atIndex + 1);

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      ok: false,
      reason: 'ไม่อนุญาตให้ใช้อีเมลชั่วคราว (disposable email) กรุณาใช้อีเมลถาวร'
    };
  }

  try {
    const mxRecords = await dns.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return {
        ok: false,
        reason: `โดเมน "${domain}" ไม่มี mail server กรุณาตรวจสอบการสะกดอีเมลให้ถูกต้อง`
      };
    }
    return { ok: true };
  } catch (err) {
    // ENODATA = ไม่มี MX record, ENOTFOUND = domain ไม่มีอยู่จริง
    const friendly = (err.code === 'ENOTFOUND')
      ? `ไม่พบโดเมน "${domain}" กรุณาตรวจสอบการสะกดอีเมลให้ถูกต้อง`
      : `โดเมน "${domain}" ไม่สามารถรับอีเมลได้ กรุณาตรวจสอบการสะกด`;
    return { ok: false, reason: friendly };
  }
}

module.exports = { verifyEmailDomain, DISPOSABLE_DOMAINS };
