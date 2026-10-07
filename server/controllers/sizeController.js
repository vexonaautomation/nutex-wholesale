import { getCatalog, listPublicSizes } from '../services/catalogService.js';
import { sizeService } from '../services/sizeService.js';
import { ctx } from './helpers.js';

export async function listPublic(_req, res) {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ items: listPublicSizes(await getCatalog()) });
}

export const adminList = async (_req, res) => res.json({ items: await sizeService.list() });
export const adminCreate = async (req, res) => res.status(201).json(await sizeService.create(req.body, ctx(req)));
export const adminUpdate = async (req, res) => res.json(await sizeService.update(req.params.id, req.body, ctx(req)));
export const adminStatus = async (req, res) => res.json(await sizeService.setStatus(req.params.id, req.body.status, ctx(req)));
export const adminReorder = async (req, res) => res.json(await sizeService.reorder(req.body.ids, ctx(req)));
