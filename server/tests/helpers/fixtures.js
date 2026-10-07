import { config } from '../../config/env.js';
import { configureStorage, runtime } from '../../services/bootstrap.js';
import { MemorySheetsTransport } from '../../services/storage/memorySheetsTransport.js';
import { MemoryDriveTransport } from '../../services/storage/memoryDriveTransport.js';
import { runMigrations } from '../../services/migrationService.js';
import { driveService } from '../../services/driveService.js';
import { sheetsService } from '../../services/sheetsService.js';
import { createAdmin } from '../../services/authService.js';
import { initializeMasterData } from '../../services/setupService.js';
import { saveProduct } from '../../services/productService.js';
import { productSchema } from '../../utils/validation.js';
import { updateSettings } from '../../services/settingsService.js';

export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

// pcsForAll: most suites test order mechanics with loose pieces as a NEW
// customer, so they switch the 'pieces only for existing customers' rule off;
// the rule itself is tested in sellMode.test.js.
export async function freshStore({ masterData = true, pcsForAll = true } = {}) {
  const sheetsTransport = new MemorySheetsTransport();
  const driveTransport = new MemoryDriveTransport();
  configureStorage(config, { sheetsTransport, driveTransport });
  await runMigrations();
  await driveService.ensureFolders();
  runtime.ready = true;
  const admin = await createAdmin({ email: 'owner@nutex.test', name: 'Owner', role: 'OWNER', password: 'Password1234' });
  const adminCtx = { admin, ip: '127.0.0.1' };
  if (masterData) await initializeMasterData(adminCtx);
  if (pcsForAll) await updateSettings({ pcs_for_existing_customers_only: false }, adminCtx);
  return { sheetsTransport, driveTransport, adminCtx };
}

export async function masters() {
  const data = await sheetsService.readMany(['Categories', 'Colors', 'Sizes'], { fresh: true });
  const cat = (slug) => data.Categories.find((c) => c.slug === slug);
  const color = (name) => data.Colors.find((c) => c.color_name === name);
  const size = (name) => data.Sizes.find((s) => s.size_name === name);
  return { data, cat, color, size };
}

export async function createColorProduct(adminCtx, overrides = {}) {
  const m = await masters();
  const black = m.color('Black');
  const white = m.color('White');
  const s32 = m.size('32');
  const s34 = m.size('34');
  const s36 = m.size('36');
  const stock = overrides.stock || [
    [black, s32, 100], [black, s34, 100], [black, s36, 0],
    [white, s32, 5], [white, s34, 10], [white, s36, 10],
  ];
  const input = productSchema.parse({
    sku: overrides.sku || 'ABC101',
    product_name: overrides.product_name || 'ABC Bra',
    category_id: m.cat('padded-bra').category_id,
    mrp: overrides.mrp ?? 500,
    inventory_mode: 'COLOR_WISE',
    size_ids: [s32.size_id, s34.size_id, s36.size_id],
    color_ids: [black.color_id, white.color_id],
    stock: stock.map(([c, s, q]) => ({ color_id: c.color_id, size_id: s.size_id, stock_qty: q })),
    images: [{ drive_file_id: 'img-abc-main', image_type: 'MAIN' }],
    status: 'ACTIVE',
    ...(overrides.extra || {}),
  });
  const saved = await saveProduct(input, adminCtx);
  const variant = (colorName, sizeName) => saved.variants.find((v) => v.color_id === m.color(colorName).color_id && v.size_id === m.size(sizeName).size_id);
  return { saved, variant, m };
}

export async function createBoxProduct(adminCtx, overrides = {}) {
  const m = await masters();
  const input = productSchema.parse({
    sku: overrides.sku || 'BOXP200',
    product_name: overrides.product_name || 'Everyday Panty Mix Box',
    category_id: m.cat('everyday-panty').category_id,
    mrp: 200,
    inventory_mode: 'BOX_WISE',
    size_ids: [],
    boxes: [{ key: 'b1', units_per_box: 12, mixed_color_description: 'Assorted colours', status: 'ACTIVE' }],
    stock: [{ box_key: 'b1', stock_qty: overrides.boxes ?? 5 }],
    status: 'ACTIVE',
  });
  const saved = await saveProduct(input, adminCtx);
  return { saved, boxVariant: saved.variants.find((v) => v.inventory_mode === 'BOX_WISE') };
}

export const CUSTOMER = {
  customer_name: 'Riya Sharma',
  business_name: 'Riya Fashion Store',
  mobile: '9876543210',
  whatsapp: '',
  email: 'riya@example.com',
  billing_address: '12 MG Road, Shop 4',
  shipping_address: '',
  same_as_billing: true,
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  gstin: '',
  order_notes: '',
};

export async function inventoryOf(variantId) {
  const rows = await sheetsService.read('Inventory', { fresh: true });
  const r = rows.find((x) => x.variant_id === variantId);
  return { stock: r.stock_qty, reserved: r.reserved_qty, available: r.available_qty };
}

export function dumpAll(transport) {
  const out = {};
  for (const name of transport.sheets.keys()) out[name] = transport.dump(name);
  return out;
}
