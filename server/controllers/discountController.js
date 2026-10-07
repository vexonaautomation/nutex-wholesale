import {
  listSlabs, createSlab, updateSlab, setSlabActive, deleteSlab, previewSlabs,
} from '../services/discountService.js';
import { ctx } from './helpers.js';

export const adminList = async (_req, res) => res.json(await listSlabs());
export const adminCreate = async (req, res) => res.status(201).json(await createSlab(req.body, ctx(req)));
export const adminUpdate = async (req, res) => res.json(await updateSlab(req.params.id, req.body, ctx(req)));
export const adminDeactivate = async (req, res) => res.json(await setSlabActive(req.params.id, false, ctx(req)));
export const adminReactivate = async (req, res) => res.json(await setSlabActive(req.params.id, true, ctx(req)));
export const adminDelete = async (req, res) => res.json(await deleteSlab(req.params.id, ctx(req)));
export const adminPreview = async (req, res) => res.json(await previewSlabs(req.body.mrp_amount));
