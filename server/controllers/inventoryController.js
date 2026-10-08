import { listInventory, applyStockUpdates } from '../services/inventoryService.js';
import { stockSheetCsv, importStockSheet } from '../services/stockImportService.js';
import { badRequest } from '../utils/errors.js';
import { ctx } from './helpers.js';

export async function adminList(req, res) {
  res.json(await listInventory({ product_id: req.query.product_id, filter: req.query.filter }));
}

export async function adminUpdate(req, res) {
  res.json(await applyStockUpdates(req.body.updates, ctx(req)));
}

export async function stockSheet(_req, res) {
  const { csv, filename } = await stockSheetCsv();
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.send(csv);
}

// body = the CSV text; ?apply=1 writes, otherwise preview only
export async function stockSheetImport(req, res) {
  if (typeof req.body !== 'string' || !req.body.trim()) throw badRequest('Upload the stock sheet as a CSV file.');
  res.json(await importStockSheet(req.body, { apply: req.query.apply === '1', ...ctx(req) }));
}
