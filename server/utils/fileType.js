// Detects file type from magic bytes - never trusts the browser-supplied
// MIME type or file extension.
export function detectFileType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (b.toString('ascii', 0, 4) === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const PROOF_MIMES = [...IMAGE_MIMES, 'application/pdf'];

export function safeFileName(name) {
  return String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}
