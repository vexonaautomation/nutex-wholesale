import path from 'node:path';
import fs from 'node:fs';
import {
  catalogPreview, startCatalogImport, importStatus, CATALOG_DIR,
} from '../services/catalogImportService.js';
import { notFound } from '../utils/errors.js';
import { ctx } from './helpers.js';

export const preview = async (_req, res) => res.json(await catalogPreview());

export async function start(req, res) {
  const job = await startCatalogImport({
    ...ctx(req),
    stockPerVariant: req.body.stock_per_variant,
    selling: req.body.selling,
    activate: req.body.activate,
  });
  res.status(202).json({ job });
}

export const status = (_req, res) => res.json({ job: importStatus() });

const FOLDERS = new Set(['products', 'categories', 'brand']);
const FILE_RE = /^[a-z0-9][a-z0-9_.-]*\.(jpg|jpeg|png|webp)$/i;

// Catalogue images (bundled with the app) for the admin preview grid.
export function image(req, res) {
  const { folder, file } = req.params;
  if (!FOLDERS.has(folder) || !FILE_RE.test(file)) throw notFound('Image not found.');
  const full = path.join(CATALOG_DIR, 'images', folder, file);
  if (!fs.existsSync(full)) throw notFound('Image not found.');
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(full);
}
