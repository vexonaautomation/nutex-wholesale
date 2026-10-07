import { sitemapXml, robotsTxt, renderIndex } from '../services/seoService.js';
import { getPublicMedia } from '../services/mediaService.js';
import { demoQrPng } from '../services/demoQrService.js';

export async function demoQr(_req, res) {
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  res.send(await demoQrPng());
}

export async function sitemap(req, res) {
  res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  res.send(await sitemapXml(req));
}

export function robots(req, res) {
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
  res.send(robotsTxt(req));
}

// Public images (product/category/color/logo/QR) streamed from Google Drive.
// Drive file IDs are immutable, so responses can be cached for a long time.
export async function media(req, res) {
  const file = await getPublicMedia(req.params.fileId);
  res.set({
    'Content-Type': file.mimeType,
    'Cache-Control': 'public, max-age=604800, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(file.buffer);
}

export async function spa(req, res, next) {
  const html = await renderIndex(req);
  if (!html) return next();
  res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  return res.send(html);
}
