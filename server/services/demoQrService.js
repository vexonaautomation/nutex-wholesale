import QRCode from 'qrcode';

// SAMPLE payment QR shown until the admin uploads the company's real UPI QR.
// It is a real, scannable QR code - but it only contains plain text, NOT a UPI
// payment link, so no payment app can pay from it.
export const DEMO_QR_TEXT = 'NUTEX DEMO QR - sample only. This is NOT a payment QR. The company UPI QR uploaded in Admin > Settings > Payment will appear here.';

let cached = null;

export async function demoQrPng() {
  if (!cached) {
    cached = await QRCode.toBuffer(DEMO_QR_TEXT, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 560,
      color: { dark: '#3e0c24', light: '#ffffff' },
    });
  }
  return cached;
}
