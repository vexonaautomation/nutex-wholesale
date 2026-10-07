// Client-side image downscaling before upload (saves bandwidth and Drive space).
// QR codes and logos are uploaded untouched so they stay pixel-exact.
export async function compressImage(file, { maxDim = 1600, quality = 0.86, minBytes = 350 * 1024 } = {}) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < minBytes) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
