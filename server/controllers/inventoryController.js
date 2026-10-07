import { listInventory, applyStockUpdates } from '../services/inventoryService.js';
import { ctx } from './helpers.js';

export async function adminList(req, res) {
  res.json(await listInventory({ product_id: req.query.product_id, filter: req.query.filter }));
}

export async function adminUpdate(req, res) {
  res.json(await applyStockUpdates(req.body.updates, ctx(req)));
}
