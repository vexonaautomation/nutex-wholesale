import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createColorProduct } from './helpers/fixtures.js';
import {
  loadCatalogFile, planImport, startCatalogImport,
} from '../services/catalogImportService.js';
import {
  bulkSetCollection, listProductsAdmin, getProductAdmin, saveProduct,
} from '../services/productService.js';
import { getCatalog, queryProducts } from '../services/catalogService.js';
import { sheetsService } from '../services/sheetsService.js';
import { productSchema, bulkCollectionsSchema } from '../utils/validation.js';

// Online Collection: articles keep their category and are also shown on
// the /online page (Products.collections = "online").

test('catalogue: every article of the ONLINE COLLECTION pdf is tagged; import tags existing ones too', async () => {
  const { adminCtx } = await freshStore();
  const { catalog } = await loadCatalogFile();
  const online = catalog.products.filter((p) => p.collections.includes('online'));
  assert.equal(online.length, 61);
  assert.ok(online.some((p) => p.sku === '2042') && online.some((p) => p.sku === '1019'), 'old and new articles');

  await startCatalogImport({ ...adminCtx, stockPerVariant: 5, wait: true });
  let catalogView = await getCatalog({ fresh: true });
  const res = queryProducts(catalogView, { collection: 'online', limit: 100 });
  assert.equal(res.total, 61, 'shown on the Online page');
  assert.ok(res.items.every((p) => p.collections.includes('online')));
  assert.equal(queryProducts(catalogView, { category: 'lingerie-set', limit: 100 }).items.filter((p) => p.collections.includes('online')).length, 16, 'still in their own category');

  // the live site imported the articles before the tag existed: re-import only adds the tag
  const products = await sheetsService.read('Products', { fresh: true });
  const sahin = products.find((p) => p.sku === '2042');
  await sheetsService.commit([{ op: 'update', sheet: 'Products', id: sahin.product_id, patch: { collections: '', mrp: 777 } }]);
  const plan = planImport(catalog, await sheetsService.readMany(['Categories', 'Sizes', 'Colors', 'Products', 'Product_Images'], { fresh: true }));
  assert.equal(plan.existing_to_tag, 1);
  const job = await startCatalogImport({ ...adminCtx, stockPerVariant: 50, wait: true });
  assert.equal(job.created, 0);
  assert.equal(job.tagged, 1);
  const after = (await sheetsService.read('Products', { fresh: true })).find((p) => p.sku === '2042');
  assert.equal(after.collections, 'online');
  assert.equal(after.mrp, 777, 'nothing else changed');
  catalogView = await getCatalog({ fresh: true });
  assert.equal(queryProducts(catalogView, { collection: 'online', limit: 100 }).total, 61);
});

test('admin: add / remove articles to the Online Collection; the product form keeps the tag', async () => {
  const { adminCtx } = await freshStore();
  const a = await createColorProduct(adminCtx, { sku: 'ONA', product_name: 'On A' });
  const b = await createColorProduct(adminCtx, { sku: 'ONB', product_name: 'On B' });
  const ids = [a.saved.product.product_id, b.saved.product.product_id];

  let res = await bulkSetCollection(bulkCollectionsSchema.parse({ product_ids: ids, collection: 'online', add: true }), adminCtx);
  assert.deepEqual(res.updated.sort(), ['ONA', 'ONB']);
  res = await bulkSetCollection(bulkCollectionsSchema.parse({ product_ids: ids, collection: 'online', add: true }), adminCtx);
  assert.deepEqual(res.unchanged.sort(), ['ONA', 'ONB'], 'already in it');
  assert.equal((await listProductsAdmin({ collection: 'online' })).length, 2);

  // saving the product in the wizard keeps / changes the tag
  const edited = await getProductAdmin(ids[0]);
  await saveProduct(productSchema.parse({
    ...edited.product, stock: [], boxes: [], size_mrps: [],
    images: edited.images.map((i) => ({ image_id: i.image_id, drive_file_id: i.drive_file_id, image_type: i.image_type })),
  }), { ...adminCtx, productId: ids[0] });
  assert.equal((await getProductAdmin(ids[0])).product.collections, 'online', 'kept when saved as it is');
  await saveProduct(productSchema.parse({
    ...edited.product, collections: [], stock: [], boxes: [], size_mrps: [],
    images: edited.images.map((i) => ({ image_id: i.image_id, drive_file_id: i.drive_file_id, image_type: i.image_type })),
  }), { ...adminCtx, productId: ids[0] });
  assert.equal((await getProductAdmin(ids[0])).product.collections, '', 'unticked in the form');

  res = await bulkSetCollection(bulkCollectionsSchema.parse({ product_ids: [ids[1]], collection: 'online', add: false }), adminCtx);
  assert.deepEqual(res.updated, ['ONB']);
  assert.equal((await listProductsAdmin({ collection: 'online' })).length, 0);
  await assert.rejects(bulkSetCollection({ product_ids: ids, collection: 'summer', add: true }, adminCtx), /Unknown collection/);
});
