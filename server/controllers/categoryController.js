import { getCatalog, listPublicCategories } from '../services/catalogService.js';
import { categoryService } from '../services/categoryService.js';
import { ctx } from './helpers.js';

export async function listPublic(_req, res) {
  const catalog = await getCatalog();
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ items: listPublicCategories(catalog) });
}

export const adminList = async (_req, res) => res.json({ items: await categoryService.list() });
export const adminCreate = async (req, res) => res.status(201).json(await categoryService.create(req.body, ctx(req)));
export const adminUpdate = async (req, res) => res.json(await categoryService.update(req.params.id, req.body, ctx(req)));
export const adminStatus = async (req, res) => res.json(await categoryService.setStatus(req.params.id, req.body.status, ctx(req)));
export const adminReorder = async (req, res) => res.json(await categoryService.reorder(req.body.ids, ctx(req)));
