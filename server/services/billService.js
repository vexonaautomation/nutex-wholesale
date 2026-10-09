// Order bill PDF in the Nutex estimate format (Admin > Settings > "Order bill"):
//   header  GSTIN · title (ESTIMATE) · company name, address, phone
//           S.No (order number) · Date · Party Name · Ph · City
//   table   Item (Color, SKU) | size columns S/32 M/34 L/36 XL/38 ... FreeSize
//           | Total Qty (Dzn) | Rate (per piece MRP) | Disc | Amount
//   footer  Terms & Conditions · totals · (Less: Packing charges) · GRAND TOTAL · signatures
// Read-only: built from the order's own snapshots, nothing is written.
import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import {
  loadOrderBundle, authorizeOrder, activeItems, billAvailable,
} from './orderService.js';
import { getSettings } from './settingsService.js';
import { sheetsService } from './sheetsService.js';
import { INVENTORY_MODE } from '../config/constants.js';
import { conflict } from '../utils/errors.js';
import { round2 } from '../utils/money.js';

// ------------------------------------------------------------ size columns
// Nutex sizes: S starts at 32 (S/32, M/34, L/36, XL/38, ...). Letter sizes and
// bra numbers share one column; any other size (e.g. 80-90) gets its own.
const LETTERS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const LETTER_NUMBER = { XXS: '28', XS: '30', S: '32', M: '34', L: '36', XL: '38', XXL: '40', '3XL': '42', '4XL': '44', '5XL': '46' };
const NUMBER_LETTER = Object.fromEntries(Object.entries(LETTER_NUMBER).map(([l, n]) => [n, l]));
const LETTER_ALIAS = { '2XL': 'XXL', XXXL: '3XL', '2XS': 'XXS' };
const ALWAYS = ['S', 'M', 'L', 'XL', 'FREE'];

export function sizeColumn(raw) {
  const name = String(raw ?? '').trim();
  const up = name.toUpperCase().replace(/\s+/g, ' ');
  if (!name || /^(FREE ?SIZE|FREE|FS)$/.test(up)) return { key: 'FREE', label: 'FreeSize', sub: '', order: 1000 };
  const letter = NUMBER_LETTER[up] || LETTER_ALIAS[up] || (LETTERS.includes(up) ? up : null);
  if (letter) return { key: letter, label: letter, sub: LETTER_NUMBER[letter], order: LETTERS.indexOf(letter) };
  const n = parseFloat(up);
  return { key: `X:${name}`, label: name, sub: '', order: 100 + (Number.isFinite(n) ? n : 900) };
}

const columnFor = (key) => (key === 'FREE' ? sizeColumn('Free Size') : sizeColumn(key));

// ------------------------------------------------------------ bill data
export const formatDzn = (pcs) => `${Number((pcs / 12).toFixed(2))} Dzn`;
const istDate = (iso) => {
  const d = new Date(new Date(iso || Date.now()).getTime() + 5.5 * 3600 * 1000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
};

/**
 * Rows grouped like the estimate: one row per article + colour + rate (boxes = "Mix").
 * `productSkus` (product_id -> article SKU) prints the article's SKU instead of
 * the size/colour-specific variant SKU saved on the order line.
 */
export function buildBill({
  order, items, settings, productSkus = {},
}) {
  const rows = new Map();
  const used = new Set(ALWAYS);
  for (const i of items) {
    const isBox = i.inventory_mode_snapshot === INVENTORY_MODE.BOX_WISE;
    const units = isBox ? Number(i.units_per_box_snapshot) || 1 : 1;
    const pcs = (Number(i.qty) || 0) * units;
    const rate = round2((Number(i.mrp_unit_snapshot) || 0) / units);
    const disc = Number(i.discount_percent_snapshot) || 0;
    const colour = isBox ? 'Mix' : i.color_snapshot || 'Mix';
    const key = [i.product_id, colour, rate, disc].join('|');
    if (!rows.has(key)) {
      rows.set(key, {
        product_name: i.product_name_snapshot, sku: productSkus[i.product_id] || i.sku_snapshot, colour, rate, disc, sizes: {}, pcs: 0, amount: 0,
      });
    }
    const row = rows.get(key);
    const col = sizeColumn(i.size_snapshot).key;
    used.add(col);
    row.sizes[col] = (row.sizes[col] || 0) + pcs;
    row.pcs += pcs;
    row.amount = round2(row.amount + (Number(i.line_total) || 0));
  }
  const list = [...rows.values()];
  const columns = [...used].map(columnFor).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const totalPcs = list.reduce((s, r) => s + r.pcs, 0);
  const subtotal = round2(list.reduce((s, r) => s + r.amount, 0));
  return {
    title: String(settings.bill_title || 'ESTIMATE').trim() || 'ESTIMATE',
    company: {
      name: settings.company_name || '',
      gstin: settings.company_gstin || '',
      address: String(settings.company_address || '').replace(/\s*\n\s*/g, ', '),
      phone: settings.company_phone || '',
    },
    number: order.order_number,
    date: istDate(order.created_at),
    party: {
      name: order.business_name_snapshot || order.customer_name_snapshot || '',
      phone: order.mobile_snapshot || '',
      city: order.city_snapshot || '',
    },
    columns,
    rows: list,
    total_pcs: totalPcs,
    total_dzn: formatDzn(totalPcs),
    subtotal,
    gst: 0,
    // "Less: Packing charges" the admin took off this order (already in final_payable)
    packing_deduction: round2(Number(order.packing_deduction) || 0),
    grand_total: round2(Number(order.final_payable) || subtotal),
    terms: String(settings.bill_terms || '').split('\n').map((t) => t.trim()).filter(Boolean),
  };
}

// ------------------------------------------------------------ PDF
const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('@fontsource/inter/package.json')), 'files');
const font = (subset, weight) => path.join(FONT_DIR, `inter-${subset}-${weight}-normal.woff`);
const INK = '#111827';
const SOFT = '#6b7280';
const GRID = '#cfd8e6';
const BLUE = '#3b82f6';
const RED = '#e11d48';
const NAVY = '#1e3fae';

export function renderBillPdf(bill) {
  // landscape only when an order uses many different sizes
  const landscape = bill.columns.length > 9;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 0, info: { Title: `${bill.title} ${bill.number}`, Author: bill.company.name } });
  doc.registerFont('R', font('latin', 400));
  doc.registerFont('B', font('latin', 700));
  // the rupee sign lives in the latin-ext subset, digits in latin
  doc.registerFont('RX', font('latin-ext', 400));
  doc.registerFont('BX', font('latin-ext', 700));

  const W = doc.page.width;
  const H = doc.page.height;
  const L = 44;
  const R = W - 44;
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const text = (s, x, y, { f = 'R', size = 9, color = INK, width, align = 'left', oneLine = false } = {}) => {
    let str = String(s ?? '');
    let fs = size;
    if (oneLine && width) {
      // one line: shrink a little to fit, then cut letters with "…" (long names / SKUs)
      doc.font(f);
      while (fs > size * 0.8 && doc.fontSize(fs).widthOfString(str) > width) fs -= 0.25;
      if (doc.fontSize(fs).widthOfString(str) > width) {
        while (str.length > 1 && doc.widthOfString(`${str}…`) > width) str = str.slice(0, -1);
        str = `${str}…`;
      }
    }
    const opts = { width, align, lineBreak: !oneLine && Boolean(width) && align === 'left', lineGap: 1 };
    doc.font(f).fontSize(fs).fillColor(color).text(str, x, y, opts);
  };
  const money = (amount, right, y, {
    bold = true, size = 9, color = INK, minus = false,
  } = {}) => {
    const digits = Number(amount || 0).toFixed(2);
    doc.fontSize(size);
    const sign = minus ? '- ' : '';
    const wS = doc.font(bold ? 'B' : 'R').widthOfString(sign);
    const wR = doc.font(bold ? 'BX' : 'RX').widthOfString('₹');
    const wD = doc.font(bold ? 'B' : 'R').widthOfString(digits);
    const x = right - wR - wD;
    if (minus) doc.font(bold ? 'B' : 'R').fillColor(color).text(sign, x - wS, y, { lineBreak: false });
    doc.font(bold ? 'BX' : 'RX').fillColor(color).text('₹', x, y, { lineBreak: false });
    doc.font(bold ? 'B' : 'R').fillColor(color).text(digits, x + wR, y, { lineBreak: false });
  };
  const hline = (y, color = INK, width = 1.2, dash = null) => {
    doc.save().lineWidth(width).strokeColor(color);
    if (dash) doc.dash(dash.l, { space: dash.s });
    doc.moveTo(L, y).lineTo(R, y).stroke().restore();
  };
  const frame = () => doc.save().lineWidth(1.2).strokeColor(INK).rect(30, 30, W - 60, H - 60).stroke().restore();

  // ---- table geometry
  const fixed = { qty: 56, rate: 46, disc: 34, amount: 66 };
  const sizeW = 30;
  const freeW = 44;
  const sizeCols = bill.columns.map((c) => ({ ...c, w: c.key === 'FREE' ? freeW : sizeW }));
  const itemW = R - L - sizeCols.reduce((s, c) => s + c.w, 0) - fixed.qty - fixed.rate - fixed.disc - fixed.amount;
  const cols = [{ key: 'item', w: itemW }, ...sizeCols.map((c) => ({ key: `s:${c.key}`, w: c.w, c })), { key: 'qty', w: fixed.qty }, { key: 'rate', w: fixed.rate }, { key: 'disc', w: fixed.disc }, { key: 'amount', w: fixed.amount }];
  let cx = L;
  for (const c of cols) { c.x = cx; cx += c.w; }
  const HEAD_H = 32;
  const ROW_H = 40;

  const tableHeader = (y) => {
    doc.save().lineWidth(1).strokeColor(BLUE).rect(L, y, R - L, HEAD_H).stroke().restore();
    for (const c of cols.slice(1)) doc.save().lineWidth(0.6).strokeColor(GRID).moveTo(c.x, y + 1).lineTo(c.x, y + HEAD_H - 1).stroke().restore();
    const mid = y + HEAD_H / 2;
    text('Item', L + 8, mid - 5, { size: 8.5, color: SOFT });
    for (const c of cols) {
      if (!c.c) continue;
      if (c.c.sub) {
        text(c.c.label, c.x, mid - 9, { size: 7, color: SOFT, width: c.w, align: 'center' });
        text(c.c.sub, c.x, mid + 1, { size: 7, color: SOFT, width: c.w, align: 'center' });
      } else {
        text(c.c.label, c.x, mid - 4, { size: c.key === 's:FREE' ? 6.8 : 7, color: SOFT, width: c.w, align: 'center' });
      }
    }
    const q = cols.find((c) => c.key === 'qty');
    text('Total', q.x, mid - 10, { size: 8.5, color: SOFT, width: q.w, align: 'center' });
    text('Qty (Dzn)', q.x, mid + 1, { size: 8.5, color: SOFT, width: q.w, align: 'center' });
    const rate = cols.find((c) => c.key === 'rate');
    text('Rate', rate.x, mid - 5, { size: 8.5, color: SOFT, width: rate.w - 6, align: 'right' });
    const disc = cols.find((c) => c.key === 'disc');
    text('Disc', disc.x, mid - 5, { size: 8.5, color: SOFT, width: disc.w, align: 'center' });
    const amt = cols.find((c) => c.key === 'amount');
    text('Amount', amt.x, mid - 5, { size: 8.5, color: SOFT, width: amt.w - 6, align: 'right' });
    return y + HEAD_H;
  };

  const tableRow = (row, y) => {
    doc.save().lineWidth(0.6).strokeColor(GRID);
    doc.rect(L, y, R - L, ROW_H).stroke();
    for (const c of cols.slice(1)) doc.moveTo(c.x, y).lineTo(c.x, y + ROW_H).stroke();
    doc.restore();
    text(row.product_name, L + 8, y + 5, { f: 'B', size: 8, width: itemW - 12, oneLine: true });
    text(`Color: ${row.colour}`, L + 8, y + 16, { size: 7.5, width: itemW - 12, oneLine: true });
    text(`SKU: ${row.sku}`, L + 8, y + 26, { size: 7.5, width: itemW - 12, oneLine: true });
    const mid = y + ROW_H / 2 - 4;
    for (const c of cols) {
      if (!c.c) continue;
      const n = row.sizes[c.c.key];
      if (n) text(n, c.x, mid, { size: 8, width: c.w, align: 'center' });
    }
    const q = cols.find((c) => c.key === 'qty');
    text(formatDzn(row.pcs), q.x, mid, { f: 'B', size: 8.5, width: q.w, align: 'center' });
    const rate = cols.find((c) => c.key === 'rate');
    text(Number(row.rate).toFixed(2), rate.x, mid, { size: 8, width: rate.w - 6, align: 'right' });
    const disc = cols.find((c) => c.key === 'disc');
    text(`${Number(row.disc.toFixed(2))}%`, disc.x, mid, { size: 8, color: RED, width: disc.w, align: 'center' });
    const amt = cols.find((c) => c.key === 'amount');
    money(row.amount, amt.x + amt.w - 6, mid, { size: 8.5 });
    return y + ROW_H;
  };

  // ---- page 1 header
  frame();
  text(bill.company.gstin ? `GSTIN: ${bill.company.gstin}` : '', L, 58, { f: 'B', size: 8.5 });
  text(bill.title.toUpperCase(), L, 56, { f: 'B', size: 10, width: R - L, align: 'center', color: '#374151' });
  text(bill.company.name, L, 72, { f: 'B', size: 24, width: R - L, align: 'center' });
  let y = 102;
  if (bill.company.address) { text(bill.company.address, L, y, { size: 8.5, width: R - L, align: 'center', color: '#374151' }); y += 12; }
  if (bill.company.phone) { text(`Phone: ${bill.company.phone}`, L, y, { size: 8.5, width: R - L, align: 'center', color: '#374151' }); y += 12; }
  y += 6;
  hline(y, INK, 1.4);
  text(`S.No: ${bill.number}`, L, y + 8, { f: 'B', size: 9 });
  text(`Date: ${bill.date}`, L, y + 8, { f: 'B', size: 9, width: R - L, align: 'right' });
  y += 26;
  hline(y, INK, 1.4);
  text(`Party Name: ${bill.party.name}`, L, y + 10, { f: 'B', size: 10.5, width: (R - L) * 0.45 });
  text(`Ph: ${bill.party.phone}`, L + (R - L) * 0.4, y + 10, { f: 'B', size: 10.5 });
  text(`City: ${bill.party.city}`, L, y + 10, { f: 'B', size: 10.5, width: R - L, align: 'right' });
  y += 30;
  hline(y, '#9ca3af', 0.7, { l: 1.5, s: 1.5 });
  y += 14;

  // ---- table (header repeated on every page)
  const bottom = H - 48;
  y = tableHeader(y);
  for (const row of bill.rows) {
    if (y + ROW_H > bottom) {
      doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 0 });
      frame();
      y = tableHeader(48);
    }
    y = tableRow(row, y);
  }

  // ---- totals, terms, signatures (kept together)
  const FOOT_H = 250 + (bill.packing_deduction > 0 ? 28 : 0);
  if (y + FOOT_H > bottom) {
    doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 0 });
    frame();
    y = 40;
  }
  y += 24;
  const tx = L + (R - L) * 0.52;
  const termsW = tx - L - 20;
  text('Terms & Conditions:', L, y + 4, { f: 'B', size: 8.5 });
  let ty = y + 18;
  for (const t of bill.terms) {
    text(t, L, ty, { size: 8, width: termsW });
    ty += doc.font('R').fontSize(8).heightOfString(t, { width: termsW, lineGap: 1 }) + 3;
  }
  const line = (label, yy, value, { money: isMoney = true, minus = false } = {}) => {
    text(label, tx, yy, { size: 10, width: (R - tx) * 0.6, align: 'right', color: '#374151' });
    if (isMoney) money(value, R, yy, { size: 10.5, minus });
    else text(value, tx, yy, { f: 'B', size: 10.5, width: R - tx, align: 'right' });
    doc.save().lineWidth(0.5).strokeColor('#e5e7eb').dash(2, { space: 2 }).moveTo(tx, yy + 20).lineTo(R, yy + 20).stroke().restore();
  };
  line('Total Quantity (Dzn):', y, bill.total_dzn, { money: false });
  line('Taxable Subtotal:', y + 28, bill.subtotal);
  line('Total GST:', y + 56, bill.gst);
  const extra = bill.packing_deduction > 0 ? 28 : 0;
  if (extra) line('Less: Packing charges:', y + 84, bill.packing_deduction, { minus: true });
  doc.save().lineWidth(0.8).strokeColor('#9ca3af').moveTo(tx, y + 78 + extra).lineTo(R, y + 78 + extra).stroke().restore();
  text('GRAND TOTAL:', tx, y + 94 + extra, { f: 'B', size: 14, width: (R - tx) * 0.58, align: 'right', color: NAVY });
  money(bill.grand_total, R, y + 92 + extra, { size: 16, color: NAVY });

  const sy = Math.max(ty, y + 130 + extra) + 40;
  text('Sales Representative: .....................................', L, sy, { size: 8.5 });
  text("Customer's Signature: .....................................", L, sy, { size: 8.5, width: R - L, align: 'right' });
  doc.font('B').fontSize(10);
  const forName = bill.company.name;
  const wName = doc.widthOfString(forName);
  doc.font('R').fontSize(10);
  const wFor = doc.widthOfString('For ');
  text('For ', R - wName - wFor, sy + 40, { size: 10 });
  text(forName, R - wName, sy + 40, { f: 'B', size: 10 });
  doc.save().lineWidth(1).strokeColor('#4b5563').moveTo(R - 160, sy + 104).lineTo(R, sy + 104).stroke().restore();
  text('Authorized Signatory', L, sy + 112, { f: 'B', size: 9, width: R - L, align: 'right' });

  doc.end();
  return done;
}

// ------------------------------------------------------------ access
export const billFileName = (bill) => `${bill.title.replace(/[^A-Za-z0-9]+/g, '_')}_${bill.number}.pdf`;

async function billFor(bundle) {
  const [settings, products] = await Promise.all([getSettings(), sheetsService.read('Products')]);
  const productSkus = Object.fromEntries(products.map((p) => [p.product_id, p.sku]));
  const bill = buildBill({
    order: bundle.order, items: activeItems(bundle.items, bundle.order.order_id), settings, productSkus,
  });
  return { bill, pdf: await renderBillPdf(bill), filename: billFileName(bill) };
}

export async function customerBill(orderNumber, token) {
  const bundle = await loadOrderBundle(orderNumber);
  authorizeOrder(bundle.order, token);
  if (!billAvailable(bundle.order)) {
    throw conflict('BILL_NOT_READY', 'The bill can be downloaded after you submit the payment.');
  }
  return billFor(bundle);
}

export async function adminBill(idOrNumber) {
  const bundle = await loadOrderBundle(idOrNumber, { byId: true });
  return billFor(bundle);
}
