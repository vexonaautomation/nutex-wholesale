import { getCatalog, listPublicColors } from '../services/catalogService.js';
import { colorService } from '../services/colorService.js';
import { ctx } from './helpers.js';

export async function listPublic(_req, res) {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ items: listPublicColors(await getCatalog()) });
}

export const adminList = async (_req, res) => res.json({ items: await colorService.list() });
export const adminCreate = async (req, res) => res.status(201).json(await colorService.create(req.body, ctx(req)));
export const adminUpdate = async (req, res) => res.json(await colorService.update(req.params.id, req.body, ctx(req)));
export const adminStatus = async (req, res) => res.json(await colorService.setStatus(req.params.id, req.body.status, ctx(req)));
export const adminReorder = async (req, res) => res.json(await colorService.reorder(req.body.ids, ctx(req)));
