const dns = require('dns').promises;
const { domainToASCII } = require('url');

// ── Disposable / temporary email domain blocklist ────────────────────────────
// ครอบคลุม service ยอดนิยม + alias domains ที่ mailinator/yopmail/guerrillamail ใช้
// production แนะนำ sync จาก https://github.com/disposable-email-domains/disposable-email-domains
// Set ถูก hide จาก export — เข้าผ่าน isDisposableDomain() เท่านั้น เพื่อกัน mutate
const DISPOSABLE_DOMAINS = new Set([
  // mailinator + alias
  'mailinator.com', 'mailinator.net', 'mailinator2.com',
  'binkmail.com', 'bobmail.info', 'chammy.info', 'devnullmail.com',
  'letthemeatspam.com', 'mailinater.com', 'mailinator.org', 'mailinator.us',
  'reallymymail.com', 'sogetthis.com', 'spamhereplease.com',
  'spamthisplease.com', 'streetwisemail.com', 'suremail.info',
  'thisisnotmyrealemail.com', 'tradermail.info', 'veryrealemail.com',
  'zippymail.info',
  // 10minutemail family
  '10minutemail.com', '10minutemail.net', '20minutemail.com',
  // guerrillamail family
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'guerrillamail.de', 'sharklasers.com',
  'grr.la', 'spam4.me',
  // tempmail family
  'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmailo.com',
  // trashmail family
  'trashmail.com', 'trashmail.net', 'trashmail.io',
  // yopmail
  'yopmail.com', 'yopmail.net', 'yopmail.fr',
  // throwaway
  'throwaway.email', 'throwawaymail.com',
  // misc
  'maildrop.cc', 'getnada.com', 'nada.email',
  'dispostable.com', 'dispostable.net', 'fakeinbox.com', 'fakemail.net',
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

// RFC 2606 reserved / test TLDs — ห้ามใช้สมัครจริง
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost']);

const DNS_TIMEOUT_MS = 3000;
const MAX_DOMAIN_DISPLAY_LEN = 80;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timeout after ${ms}ms`);
      err.code = 'ETIMEOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Suffix-match disposable: เช็ค domain เอง + ทุก parent label
// foo.mailinator.com → check 'foo.mailinator.com', 'mailinator.com'
function isDisposableDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const normalized = domain.toLowerCase().replace(/\.+$/, '');
  const labels = normalized.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (DISPOSABLE_DOMAINS.has(candidate)) return true;
  }
  return false;
}

// กัน reflected user input ใน error message / logs
function sanitizeDomainForDisplay(domain) {
  const cleaned = domain.replace(/[^\x20-\x7E]/g, '?');
  if (cleaned.length > MAX_DOMAIN_DISPLAY_LEN) {
    return cleaned.slice(0, MAX_DOMAIN_DISPLAY_LEN) + '…';
  }
  return cleaned;
}

const TRANSIENT_CODES = new Set([
  'ETIMEOUT', 'ETIMEDOUT', 'EAI_AGAIN',
  'ESERVFAIL', 'ECONNREFUSED', 'ENETUNREACH', 'EREFUSED'
]);

/**
 *  1) format check
 *  2) IDN → punycode
 *  3) reject reserved TLDs (.test/.example/.invalid/.localhost)
 *  4) reject disposable (suffix match)
 *  5) DNS MX lookup (with timeout) + A/AAAA fallback (RFC 5321 §5.1)
 *
 *  Transient DNS failures fail-OPEN with { ok:true, transient:true } —
 *  caller can log/monitor but registration is not blocked by upstream resolver hiccups.
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

  // strip trailing dot (FQDN form) — กัน bypass `mailinator.com.`
  const rawDomain = trimmed.slice(atIndex + 1).replace(/\.+$/, '');

  // IDN → punycode (A-label) เพื่อ DNS lookup ทำงานได้
  let asciiDomain;
  try {
    asciiDomain = domainToASCII(rawDomain) || rawDomain;
  } catch {
    asciiDomain = rawDomain;
  }
  if (!asciiDomain) {
    return { ok: false, reason: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }

  const safeDomain = sanitizeDomainForDisplay(asciiDomain);

  const tld = asciiDomain.split('.').pop();
  if (RESERVED_TLDS.has(tld)) {
    return {
      ok: false,
      reason: `โดเมน "${safeDomain}" เป็นโดเมนสำรองที่ไม่ใช้รับอีเมลจริง`
    };
  }

  if (isDisposableDomain(asciiDomain)) {
    return {
      ok: false,
      reason: 'ไม่อนุญาตให้ใช้อีเมลชั่วคราว (disposable email) กรุณาใช้อีเมลถาวร'
    };
  }

  try {
    let mxRecords = [];
    try {
      mxRecords = await withTimeout(dns.resolveMx(asciiDomain), DNS_TIMEOUT_MS, 'resolveMx');
    } catch (mxErr) {
      if (mxErr.code === 'ENOTFOUND') {
        return {
          ok: false,
          reason: `ไม่พบโดเมน "${safeDomain}" กรุณาตรวจสอบการสะกดอีเมลให้ถูกต้อง`
        };
      }
      if (TRANSIENT_CODES.has(mxErr.code)) throw mxErr;
      // ENODATA หรืออื่น ๆ → fall through ไปลอง A/AAAA
    }

    if (mxRecords && mxRecords.length > 0) {
      return { ok: true };
    }

    // RFC 5321 implicit-MX fallback: A/AAAA
    try {
      const aRecords = await withTimeout(dns.resolve4(asciiDomain), DNS_TIMEOUT_MS, 'resolve4');
      if (aRecords && aRecords.length > 0) return { ok: true };
    } catch (aErr) {
      if (TRANSIENT_CODES.has(aErr.code)) throw aErr;
      try {
        const aaaa = await withTimeout(dns.resolve6(asciiDomain), DNS_TIMEOUT_MS, 'resolve6');
        if (aaaa && aaaa.length > 0) return { ok: true };
      } catch (aaaaErr) {
        if (TRANSIENT_CODES.has(aaaaErr.code)) throw aaaaErr;
      }
    }

    return {
      ok: false,
      reason: `โดเมน "${safeDomain}" ไม่มี mail server กรุณาตรวจสอบการสะกดอีเมลให้ถูกต้อง`
    };
  } catch (err) {
    if (TRANSIENT_CODES.has(err.code)) {
      console.warn('[emailValidator] transient DNS failure, allowing through:',
        { domain: safeDomain, code: err.code, message: err.message });
      return { ok: true, transient: true };
    }
    console.error('[emailValidator] unexpected error:', err);
    return {
      ok: false,
      reason: `โดเมน "${safeDomain}" ไม่สามารถยืนยันได้ กรุณาตรวจสอบการสะกด`
    };
  }
}

module.exports = {
  verifyEmailDomain,
  isDisposableDomain
};
