import { getDashboard } from '../services/dashboardService.js';
import { listAudit } from '../services/auditService.js';
import { exportSheet, exportableSheets } from '../services/exportService.js';
import { initializeMasterData } from '../services/setupService.js';
import { driveService } from '../services/driveService.js';
import { getAdminMedia } from '../services/mediaService.js';
import { runtime } from '../services/bootstrap.js';
import { detectFileType, IMAGE_MIMES, safeFileName } from '../utils/fileType.js';
import { badRequest } from '../utils/errors.js';
import { DRIVE_FOLDERS } from '../config/constants.js';
import { config } from '../config/env.js';
import { ctx } from './helpers.js';

export const dashboard = async (_req, res) => res.json(await getDashboard());
export const audit = async (req, res) => res.json(await listAudit(req.query));
export const setupMasterData = async (req, res) => res.json(await initializeMasterData(ctx(req)));

export function exportList(_req, res) {
  res.json({ sheets: exportableSheets() });
}

export async function exportCsv(req, res) {
  const { filename, csv } = await exportSheet(req.params.sheet, ctx(req));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send(csv);
}

const FOLDER_BY_PURPOSE = {
  product: DRIVE_FOLDERS.PRODUCTS,
  category: DRIVE_FOLDERS.CATEGORIES,
  color: DRIVE_FOLDERS.COLORS,
  qr: DRIVE_FOLDERS.PAYMENT,
  logo: DRIVE_FOLDERS.BRAND,
};

// Admin image upload -> Google Drive. Returns IDs to be saved on the record.
export async function uploadImage(req, res) {
  const purpose = String(req.body?.purpose || 'product');
  const folder = FOLDER_BY_PURPOSE[purpose];
  if (!folder) throw badRequest('Unknown upload purpose.');
  if (!req.file?.buffer?.length) throw badRequest('Choose an image to upload.');
  const type = detectFileType(req.file.buffer);
  if (!type || !IMAGE_MIMES.includes(type.mime)) throw badRequest('Only JPG, PNG or WEBP images are allowed.');
  const base = safeFileName((req.file.originalname || 'image').replace(/\.[^.]+$/, ''));
  const stored = await driveService.upload({
    buffer: req.file.buffer,
    mimeType: type.mime,
    filename: `${purpose}-${Date.now()}-${base}.${type.ext}`,
    folder,
  });
  res.status(201).json({ ...stored, preview_url: `/api/admin/media/${encodeURIComponent(stored.file_id)}` });
}

export async function adminMedia(req, res) {
  const file = await getAdminMedia(req.params.fileId);
  res.set({ 'Content-Type': file.mimeType, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  res.send(file.buffer);
}

export function systemStatus(_req, res) {
  res.json({
    ready: runtime.ready,
    started_at: runtime.startedAt,
    last_error: runtime.lastError,
    migration: runtime.migration,
    drive: { configured: driveService.enabled, ready: runtime.driveReady },
    backend: config.dataBackend,
    version: config.appVersion,
    node_env: config.nodeEnv,
  });
}
