const QRCode = require('qrcode');
const crypto = require('crypto');

/**
 * สร้าง token แบบสุ่มสำหรับ QR Code ของแต่ละ schedule
 */
function generateQRToken(scheduleId) {
  const randomPart = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now().toString(36);
  return `${scheduleId}_${timestamp}_${randomPart}`;
}

/**
 * แปลง payload (string/JSON) เป็น QR Code base64 Data URL
 * สำหรับแสดงบนหน้าจอครู
 */
async function generateQRCodeDataURL(payload) {
  try {
    const dataURL = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.92,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      },
      width: 400
    });
    return dataURL;
  } catch (error) {
    console.error('[QRService] Error generating QR code:', error);
    throw error;
  }
}

module.exports = { generateQRToken, generateQRCodeDataURL };
