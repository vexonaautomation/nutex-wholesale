import {
  getCatalog, queryProducts, findProduct, isProductVisible, serializeProduct,
} from '../services/catalogService.js';
import {
  listProductsAdmin, getProductAdmin, saveProduct, setProductStatus, setProductOutOfStock, duplicateProduct, bulkSetSelling,
} from '../services/productService.js';
import { RECORD_STATUS } from '../config/constants.js';
import { notFound } from '../utils/errors.js';
import { ctx, noStore } from './helpers.js';

// ------------------------------ public ------------------------------
export async function listProducts(req, res) {
  const catalog = await getCatalog();
  res.set('Cache-Control', 'public, max-age=30');
  res.json(queryProducts(catalog, req.query));
}

export async function getProduct(req, res) {
  const catalog = await getCatalog();
  const product = findProduct(catalog, req.params.id);
  if (!product || !isProductVisible(catalog, product)) throw notFound('Product is currently unavailable.');
  const related = queryProducts(catalog, { category: product.category_id, limit: 9 }).items
    .filter((p) => p.product_id !== product.product_id).slice(0, 8);
  res.set('Cache-Control', 'public, max-age=15');
  res.json({ product: serializeProduct(catalog, product, { detail: true }), related });
}

export async function getProductVariants(req, res) {
  const catalog = await getCatalog();
  const product = findProduct(catalog, req.params.id);
  if (!product || !isProductVisible(catalog, product)) throw notFound('Product is currently unavailable.');
  noStore(res);
  res.json({ product_id: product.product_id, variants: serializeProduct(catalog, product, { detail: true }).variants });
}

// ------------------------------ admin -------------------------------
export async function adminList(req, res) {
  res.json({ items: await listProductsAdmin(req.query) });
}

export async function adminGet(req, res) {
  res.json(await getProductAdmin(req.params.id));
}

export async function adminCreate(req, res) {
  res.status(201).json(await saveProduct(req.body, ctx(req)));
}

export async function adminUpdate(req, res) {
  res.json(await saveProduct(req.body, { ...ctx(req), productId: req.params.id }));
}

export async function adminDeactivate(req, res) {
  res.json(await setProductStatus(req.params.id, RECORD_STATUS.INACTIVE, ctx(req)));
}

export async function adminReactivate(req, res) {
  res.json(await setProductStatus(req.params.id, RECORD_STATUS.ACTIVE, ctx(req)));
}

export async function adminArchive(req, res) {
  res.json(await setProductStatus(req.params.id, RECORD_STATUS.ARCHIVED, ctx(req)));
}

export async function adminOutOfStock(req, res) {
  res.json(await setProductOutOfStock(req.params.id, req.body.out_of_stock, ctx(req)));
}

export async function adminDuplicate(req, res) {
  res.status(201).json(await duplicateProduct(req.params.id, ctx(req)));
}

export const adminBulkSelling = async (req, res) => res.json(await bulkSetSelling(req.body, ctx(req)));
