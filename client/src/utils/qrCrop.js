// Finds the QR code inside the payment image uploaded by the admin (often a
// whole bank standee with logos and text) so the payment page can show just
// the QR, large. The uploaded image itself is never changed: the page only
// shows a square part of it. Also reads the UPI ID from the QR (upi://pay?pa=).
//
// Result (cached per image URL): { x, y, side, iw, upi } in image pixels,
// or null when no QR is found (the full image is shown instead).

const CACHE_KEY = 'nutex_qr_crop_v1';
const MAX_SCAN = 1200; // px - scanning a smaller copy is fast and still reliable
const MARGIN = 0.08; // white border kept around the QR (scanners need it)

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function cachedQrCrop(src) {
  return src ? readCache()[src] || null : null;
}

function remember(src, value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ [src]: value }));
  } catch {
    /* storage unavailable - it is just found again next time */
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function upiIdOf(text) {
  if (!/^upi:\/\/pay\?/i.test(text || '')) return '';
  try {
    return new URLSearchParams(text.slice(text.indexOf('?') + 1)).get('pa') || '';
  } catch {
    return '';
  }
}

export async function findQrCrop(src) {
  if (!src) return null;
  const cached = cachedQrCrop(src);
  if (cached) return cached;
  const [{ default: jsQR }, img] = await Promise.all([import('jsqr'), loadImage(src)]);
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return null;
  const scale = Math.min(1, MAX_SCAN / Math.max(iw, ih));
  const w = Math.round(iw * scale);
  const h = Math.round(ih * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
  if (!found) return null;

  const { topLeftCorner: a, topRightCorner: b, bottomLeftCorner: c, bottomRightCorner: d } = found.location;
  const xs = [a.x, b.x, c.x, d.x].map((v) => v / scale);
  const ys = [a.y, b.y, c.y, d.y].map((v) => v / scale);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  // a QR that already fills the image needs no cropping
  if (size > 0.8 * Math.min(iw, ih)) return null;
  const side = Math.min(size * (1 + 2 * MARGIN), iw, ih);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const crop = {
    x: Math.round(Math.min(Math.max(0, cx - side / 2), iw - side)),
    y: Math.round(Math.min(Math.max(0, cy - side / 2), ih - side)),
    side: Math.round(side),
    iw,
    upi: upiIdOf(found.data),
  };
  remember(src, crop);
  return crop;
}
