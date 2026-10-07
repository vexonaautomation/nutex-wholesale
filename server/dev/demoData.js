// DEVELOPMENT DEMO DATA ONLY.
// Used by (a) the in-memory dev backend and (b) scripts/seedDemo.js against a
// DEVELOPMENT spreadsheet. Both paths refuse to run when NODE_ENV=production.
import zlib from 'node:zlib';
import { config } from '../config/env.js';
import { sheetsService } from '../services/sheetsService.js';
import { driveService } from '../services/driveService.js';
import { initializeMasterData } from '../services/setupService.js';
import { saveProduct } from '../services/productService.js';
import { updateSettings } from '../services/settingsService.js';
import { productSchema } from '../utils/validation.js';
import { DRIVE_FOLDERS } from '../config/constants.js';

export function assertNotProduction() {
  if (config.isProd || process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data: NODE_ENV=production. Production must never run demo seeds.');
  }
}

// --- tiny PNG encoder for placeholder demo images (no dependencies) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function demoPng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function productArt(base, accent) {
  const [r1, g1, b1] = hex(base);
  const [r2, g2, b2] = hex(accent);
  return demoPng(480, 600, (x, y) => {
    const t = y / 600;
    const cx = x - 240;
    const cy = y - 260;
    const inBlob = (cx * cx) / (150 * 150) + (cy * cy) / (120 * 120) < 1 && y > 150;
    const mix = inBlob ? 0.85 : t * 0.35;
    return [Math.round(r1 + (r2 - r1) * mix), Math.round(g1 + (g2 - g1) * mix), Math.round(b1 + (b2 - b1) * mix)];
  });
}

async function uploadPng(buffer, name, folder) {
  const res = await driveService.upload({ buffer, mimeType: 'image/png', filename: name, folder });
  return res.file_id;
}

export async function seedDemoData({ admin }) {
  assertNotProduction();
  const ctx = { admin, ip: '127.0.0.1' };
  const existing = await sheetsService.read('Products', { fresh: true });
  if (existing.length) return { skipped: true, reason: 'Products sheet already has data' };

  await initializeMasterData(ctx);
  const data = await sheetsService.readMany(['Categories', 'Colors', 'Sizes'], { fresh: true });
  const cat = (slug) => data.Categories.find((c) => c.slug === slug).category_id;
  const color = (name) => data.Colors.find((c) => c.color_name === name).color_id;
  const size = (name) => data.Sizes.find((s) => s.size_name === name).size_id;
  const withDrive = driveService.enabled;

  // No payment QR / UPI ID is set: the website shows the built-in SAMPLE QR
  // (text only, not payable) until the admin uploads the real one.
  await updateSettings({
    whatsapp_number: '919999999999',
    payment_name: 'Nutex Apparel Limited (DEMO)',
    company_phone: '+91 99999 99999',
    company_email: 'wholesale@example.com',
    company_address: 'Demo address - replace in Admin > Settings',
  }, ctx);

  // Real Nutex catalogue (catalog-import/) with TEST stock so every product
  // can be ordered. Falls back to placeholder products if it is missing.
  try {
    const { startCatalogImport } = await import('../services/catalogImportService.js');
    // DEMO box sizes (Nutex sets the real pieces-per-box in the admin): 6 pcs
    // per box, panties 12. Existing customers can always also buy pieces;
    // new customers only boxes - except camisoles, where pieces are opened.
    const selling = Object.fromEntries(['lingerie-set', 'padded-bra', 'sports-bra', 't-shirt-bra', 'everyday-bra', 'cotton-collection', 'print-collection', 'camisole-collection', 'men-collection'].map((slug) => [slug, { units_per_box: 6 }]));
    selling['everyday-panty'] = { units_per_box: 12 };
    selling['camisole-collection'].pcs_for_new_customers = true;
    const job = await startCatalogImport({
      ...ctx, stockPerVariant: 100, boxStock: 20, selling, wait: true,
    });
    if (job.created > 0) return { skipped: false, products: job.created, source: 'catalogue' };
  } catch (err) {
    console.warn(`[demo] Nutex catalogue not imported (${err.message}) - using placeholder products.`);
  }

  const products = [
    { sku: 'NX-PB101', name: 'Seamless Padded T-Shirt Bra', cat: 'padded-bra', mrp: 499, colors: ['Black', 'Skin', 'Pink'], sizes: ['32', '34', '36', '38'], art: ['#f4d9e3', '#a83a70'], featured: true },
    { sku: 'NX-SB205', name: 'High Support Sports Bra', cat: 'sports-bra', mrp: 599, colors: ['Black', 'Grey', 'Navy Blue'], sizes: ['32', '34', '36', '38', '40'], art: ['#dfe6f2', '#1f2a56'], featured: true },
    { sku: 'NX-EB310', name: 'Everyday Cotton Bra', cat: 'everyday-bra', mrp: 349, colors: ['White', 'Skin', 'Black'], sizes: ['30', '32', '34', '36', '38', '40'], art: ['#f6ecdc', '#b98a4b'] },
    { sku: 'NX-LS450', name: 'Lace Lingerie Set', cat: 'lingerie-set', mrp: 899, colors: ['Red', 'Maroon', 'Black'], sizes: ['32', '34', '36'], art: ['#f8e1e1', '#6d1b2e'], featured: true },
    { sku: 'NX-PR120', name: 'Floral Print Non-Padded Bra', cat: 'print-collection', mrp: 399, colors: ['Pink', 'White'], sizes: ['32', '34', '36', '38'], art: ['#fbe7ef', '#dc9cbb'] },
    { sku: 'NX-CM600', name: 'Cotton Camisole', cat: 'camisole-collection', mrp: 299, colors: ['White', 'Skin', 'Black'], sizes: ['Free Size'], art: ['#f1eef3', '#48404b'] },
    { sku: 'NX-MN700', name: "Men's Cotton Brief", cat: 'men-collection', mrp: 249, colors: ['Navy Blue', 'Grey', 'Black'], sizes: ['36', '38', '40', '42', '44'], art: ['#e7f0fb', '#1a5394'] },
  ];
  for (const [i, p] of products.entries()) {
    const img = withDrive ? await uploadPng(productArt(...p.art), `${p.sku}.png`, DRIVE_FOLDERS.PRODUCTS) : '';
    const stock = [];
    for (const c of p.colors) {
      for (const s of p.sizes) stock.push({ color_id: color(c), size_id: size(s), stock_qty: (i + s.length * 7 + c.length * 3) % 5 === 0 ? 0 : 40 + ((i * 13 + c.length * 11) % 120) });
    }
    await saveProduct(productSchema.parse({
      sku: p.sku, product_name: p.name, category_id: cat(p.cat), mrp: p.mrp, inventory_mode: 'COLOR_WISE',
      description: `${p.name} - demo product for testing. Replace with real products in Admin > Products.`,
      size_ids: p.sizes.map(size), color_ids: p.colors.map(color), stock, featured: !!p.featured,
      images: img ? [{ drive_file_id: img, image_type: 'MAIN', alt_text: p.name }] : [],
    }), ctx);
  }

  // box-wise demo products
  const boxes = [
    { sku: 'NX-PT900', name: 'Everyday Hipster Panty - Mix Colour Box', cat: 'everyday-panty', mrp: 149, units: 12, stock: 30, art: ['#fdf0e6', '#c27a06'] },
    { sku: 'NX-PT950', name: 'Cotton Bikini Panty - Mix Colour Box', cat: 'everyday-panty', mrp: 129, units: 10, stock: 0, art: ['#e3f4ea', '#146b41'] },
  ];
  for (const b of boxes) {
    const img = withDrive ? await uploadPng(productArt(...b.art), `${b.sku}.png`, DRIVE_FOLDERS.PRODUCTS) : '';
    await saveProduct(productSchema.parse({
      sku: b.sku, product_name: b.name, category_id: cat(b.cat), mrp: b.mrp, inventory_mode: 'BOX_WISE',
      description: 'Supplied as assorted/mixed colours. Demo product.',
      size_ids: [size('Free Size')],
      boxes: [
        { key: 'a', units_per_box: b.units, mixed_color_description: 'Assorted colours', status: 'ACTIVE' },
        { key: 'b', units_per_box: b.units * 2, size_id: size('Free Size'), mixed_color_description: 'Assorted colours - double box', status: 'ACTIVE' },
      ],
      stock: [{ box_key: 'a', stock_qty: b.stock }, { box_key: 'b', stock_qty: Math.floor(b.stock / 3) }],
      images: img ? [{ drive_file_id: img, image_type: 'MAIN', alt_text: b.name }] : [],
    }), ctx);
  }
  return { skipped: false, products: products.length + boxes.length };
}
