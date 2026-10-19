// Order bill PDF in the Nutex estimate format (Admin > Settings > "Order bill"):
//   header  GSTIN · title (ESTIMATE) · company name, address, phone
//           S.No (order number) · Date · Party Name · Ph · City
//   table   Item (Color, SKU) | size columns S/32 M/34 L/36 XL/38 ... FreeSize
//           | Total Qty (Dzn, pcs, boxes) | Rate (per piece MRP) | Disc | Amount
//   footer  Terms & Conditions · total boxes / pieces / dozens · totals
//           · (Less: Packing charges) · GRAND TOTAL + "5% GST included" · signatures
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
import { normalizeMobile } from '../utils/orderToken.js';
import { adminNamesByMobile } from './authService.js';

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
export const formatPcs = (pcs) => `${pcs} pcs`;
export const formatBoxes = (boxes) => `${boxes} ${boxes === 1 ? 'Box' : 'Boxes'}`;
const istDate = (iso) => {
  const d = new Date(new Date(iso || Date.now()).getTime() + 5.5 * 3600 * 1000);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
};

const oneLine = (v) => String(v || '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
const same = (a, b) => oneLine(a).toLowerCase() === oneLine(b).toLowerCase();

/** "Street, City, State - 302001" (city / state left out when the street already has them). */
export function fullAddress(street, city, state, pincode) {
  const s = oneLine(street);
  const has = (w) => w && s.toLowerCase().includes(String(w).toLowerCase());
  const place = [!has(city) && oneLine(city), !has(state) && oneLine(state)].filter(Boolean).join(', ');
  const tail = [place, pincode && !has(pincode) ? String(pincode).trim() : ''].filter(Boolean).join(' - ');
  return [s, tail].filter(Boolean).join(', ');
}

/** Aadhaar on a bill: only the last 4 digits (XXXX XXXX 1234). */
export function maskAadhaar(value) {
  const d = String(value || '').replace(/\D/g, '');
  return d.length >= 4 ? `XXXX XXXX ${d.slice(-4)}` : '';
}

/**
 * Rows grouped like the estimate: one row per article + colour + rate (boxes = "Mix").
 * `productSkus` (product_id -> article SKU) prints the article's SKU instead of
 * the size/colour-specific variant SKU saved on the order line.
 */
export function buildBill({
  order, items, settings, productSkus = {}, names = new Map(),
}) {
  const rows = new Map();
  const used = new Set(ALWAYS);
  for (const i of items) {
    const isBox = i.inventory_mode_snapshot === INVENTORY_MODE.BOX_WISE;
    const units = isBox ? Number(i.units_per_box_snapshot) || 1 : 1;
    const qty = Number(i.qty) || 0;
    const pcs = qty * units;
    const rate = round2((Number(i.mrp_unit_snapshot) || 0) / units);
    const disc = Number(i.discount_percent_snapshot) || 0;
    const colour = isBox ? 'Mix' : i.color_snapshot || 'Mix';
    const key = [i.product_id, colour, rate, disc].join('|');
    if (!rows.has(key)) {
      rows.set(key, {
        product_name: i.product_name_snapshot, sku: productSkus[i.product_id] || i.sku_snapshot, colour, rate, disc, sizes: {}, pcs: 0, boxes: 0, amount: 0,
      });
    }
    const row = rows.get(key);
    const col = sizeColumn(i.size_snapshot).key;
    used.add(col);
    row.sizes[col] = (row.sizes[col] || 0) + pcs;
    row.pcs += pcs;
    if (isBox) row.boxes += qty;
    row.amount = round2(row.amount + (Number(i.line_total) || 0));
  }
  const list = [...rows.values()];
  const columns = [...used].map(columnFor).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const totalPcs = list.reduce((s, r) => s + r.pcs, 0);
  const totalBoxes = list.reduce((s, r) => s + r.boxes, 0);
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
      // the business is the party; the person is printed under it
      name: order.business_name_snapshot || order.customer_name_snapshot || '',
      customer_name: order.business_name_snapshot && order.customer_name_snapshot && !same(order.business_name_snapshot, order.customer_name_snapshot)
        ? oneLine(order.customer_name_snapshot) : '',
      phone: order.mobile_snapshot || '',
      city: order.city_snapshot || '',
      address: fullAddress(order.billing_address_snapshot, order.city_snapshot, order.state_snapshot, order.pincode_snapshot),
      ship_to: order.shipping_address_snapshot && !same(order.shipping_address_snapshot, order.billing_address_snapshot)
        ? fullAddress(order.shipping_address_snapshot, order.city_snapshot, order.state_snapshot, order.pincode_snapshot) : '',
      // GST number; without GST the Aadhaar number (last 4 digits only)
      gstin: String(order.gstin_snapshot || '').trim().toUpperCase(),
      aadhaar: order.gstin_snapshot ? '' : maskAadhaar(order.aadhaar_last4),
    },
    columns,
    rows: list,
    total_boxes: totalBoxes,
    total_pcs: totalPcs,
    total_dzn: formatDzn(totalPcs),
    subtotal,
    // prices include GST: only the line "5% GST included" is printed, no amount
    gst_percent: Number(settings.gst_percent) || 0,
    // "Less: Packing charges" taken off this order (already in final_payable):
    // chosen by the customer at checkout, or set by the admin
    packing_deduction: round2(Number(order.packing_deduction) || 0),
    less_packing: order.less_packing === true,
    grand_total: round2(Number(order.final_payable) || subtotal),
    // the grand total is a round figure: difference to subtotal - packing
    round_off: (() => {
      const off = round2((Number(order.final_payable) || subtotal) - Math.max(0, subtotal - (Number(order.packing_deduction) || 0)));
      return Math.abs(off) < 1 ? off : 0;
    })(),
    terms: String(settings.bill_terms || '').split('\n').map((t) => t.trim()).filter(Boolean),
    // who made the order: the sub admin / admin of that number, else the customer online
    made_by: order.placed_by_mobile
      ? names.get(normalizeMobile(order.placed_by_mobile)) || 'Nutex team'
      : 'Online order (customer)',
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
    bold = true, size = 9, color = INK, minus = false, plus = false,
  } = {}) => {
    const digits = Number(amount || 0).toFixed(2);
    doc.fontSize(size);
    const sign = minus ? '- ' : plus ? '+ ' : '';
    const wS = doc.font(bold ? 'B' : 'R').widthOfString(sign);
    const wR = doc.font(bold ? 'BX' : 'RX').widthOfString('₹');
    const wD = doc.font(bold ? 'B' : 'R').widthOfString(digits);
    const x = right - wR - wD;
    if (sign) doc.font(bold ? 'B' : 'R').fillColor(color).text(sign, x - wS, y, { lineBreak: false });
    doc.font(bold ? 'BX' : 'RX').fillColor(color).text('₹', x, y, { lineBreak: false });
    doc.font(bold ? 'B' : 'R').fillColor(color).text(digits, x + wR, y, { lineBreak: false });
  };
  const hline = (y, color = INK, width = 1.2, dash = null) => {
    doc.save().lineWidth(width).strokeColor(color);
    if (dash) doc.dash(dash.l, { space: dash.s });
    doc.moveTo(L, y).lineTo(R, y).stroke().restore();
  };
  const frame = () => doc.save().lineWidth(1.2).strokeColor(INK).rect(30, 30, W - 60, H - 60).stroke().restore();

  // ---- table geometry (a packing slip has no rate / discount / amount)
  const slip = bill.slip === true;
  const fixed = slip ? { qty: 72 } : { qty: 56, rate: 46, disc: 34, amount: 66 };
  const sizeW = 30;
  const freeW = 44;
  const sizeCols = bill.columns.map((c) => ({ ...c, w: c.key === 'FREE' ? freeW : sizeW }));
  const itemW = R - L - sizeCols.reduce((s, c) => s + c.w, 0) - Object.values(fixed).reduce((s, w) => s + w, 0);
  const cols = [{ key: 'item', w: itemW }, ...sizeCols.map((c) => ({ key: `s:${c.key}`, w: c.w, c })), ...Object.entries(fixed).map(([key, w]) => ({ key, w }))];
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
    text('Qty', q.x, mid + 1, { size: 8.5, color: SOFT, width: q.w, align: 'center' });
    if (slip) return y + HEAD_H;
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
    // dozens, then pieces, then boxes (box rows only)
    const qy = row.boxes ? y + 5 : y + 10;
    text(formatDzn(row.pcs), q.x, qy, { f: 'B', size: 8.5, width: q.w, align: 'center' });
    text(formatPcs(row.pcs), q.x, qy + 11, { size: 7.5, width: q.w, align: 'center' });
    if (row.boxes) text(formatBoxes(row.boxes), q.x, qy + 21, { size: 7.5, width: q.w, align: 'center' });
    if (slip) return y + ROW_H;
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
  if (slip && bill.packer_name) text(`Packing by: ${bill.packer_name}`, L, y + 8, { f: 'B', size: 9, width: R - L, align: 'center' });
  text(`Date: ${bill.date}`, L, y + 8, { f: 'B', size: 9, width: R - L, align: 'right' });
  y += 26;
  hline(y, INK, 1.4);
  // party: business name + phone, customer name + GSTIN (or Aadhaar), full address
  const p = bill.party;
  const split = L + (R - L) * 0.62;
  const labelled = (label, value, x, yy, { size = 9.5, width, bold = false } = {}) => {
    doc.font('B').fontSize(size).fillColor(INK).text(label, x, yy, { width, continued: true, lineGap: 1 })
      .font(bold ? 'B' : 'R').text(` ${value}`, { lineGap: 1 });
    return doc.y;
  };
  let py = y + 9;
  labelled('Party Name:', p.name, L, py, { size: 10.5, width: split - L - 12, bold: true });
  text(`Ph: ${p.phone}`, split, py, { f: 'B', size: 10.5, width: R - split, align: 'right' });
  py += 17;
  const idLine = p.gstin ? `GSTIN: ${p.gstin}` : p.aadhaar ? `Aadhaar No: ${p.aadhaar}` : 'GSTIN: Not registered';
  if (p.customer_name) labelled('Customer Name:', p.customer_name, L, py, { width: split - L - 12 });
  text(idLine, split, py, { f: 'B', size: 9.5, width: R - split, align: 'right' });
  py += 15;
  if (p.address) py = labelled('Address:', p.address, L, py, { width: R - L }) + 2;
  if (p.ship_to) py = labelled('Ship to:', p.ship_to, L, py, { width: R - L }) + 2;
  y = py + 6;
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

  // ---- packing slip: quantities, notes and signatures only - no amounts
  if (slip) {
    if (y + 240 > bottom) {
      doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 0 });
      frame();
      y = 40;
    }
    y += 24;
    const sx = L + (R - L) * 0.52;
    const notesW = sx - L - 20;
    text('Packing notes:', L, y + 4, { f: 'B', size: 8.5 });
    let ny = y + 18;
    for (const t of bill.notes?.length ? bill.notes : ['-']) {
      text(t, L, ny, { size: 8.5, width: notesW });
      ny += doc.font('R').fontSize(8.5).heightOfString(t, { width: notesW, lineGap: 1 }) + 4;
    }
    let qy = y;
    for (const [label, value] of [['Total Boxes:', formatBoxes(bill.total_boxes)], ['Total Pieces:', formatPcs(bill.total_pcs)], ['Total Quantity (Dzn):', bill.total_dzn]]) {
      text(label, sx, qy, { size: 10, width: (R - sx) * 0.6, align: 'right', color: '#374151' });
      text(value, sx, qy, { f: 'B', size: 10.5, width: R - sx, align: 'right' });
      doc.save().lineWidth(0.5).strokeColor('#e5e7eb').dash(2, { space: 2 }).moveTo(sx, qy + 20).lineTo(R, qy + 20).stroke().restore();
      qy += 28;
    }
    const sy2 = Math.max(ny, qy) + 44;
    text(`Packed by: ${bill.packer_name || '.......................................'}`, L, sy2, { f: 'B', size: 9.5 });
    text('Checked by: .......................................', L, sy2, { size: 9, width: R - L, align: 'right' });
    text(`Made by: ${bill.made_by}`, L, sy2 + 26, { size: 8.5, color: SOFT });
    text('Packing slip - prices are on the bill.', L, sy2 + 26, { size: 8.5, width: R - L, align: 'right', color: SOFT });
    doc.end();
    return done;
  }

  // ---- totals, terms, signatures (kept together)
  const FOOT_H = 306 + (bill.packing_deduction > 0 ? 28 : 0) + (bill.round_off ? 28 : 0);
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
  const line = (label, yy, value, { money: isMoney = true, minus = false, plus = false } = {}) => {
    text(label, tx, yy, { size: 10, width: (R - tx) * 0.6, align: 'right', color: '#374151' });
    if (isMoney) money(value, R, yy, { size: 10.5, minus, plus });
    else text(value, tx, yy, { f: 'B', size: 10.5, width: R - tx, align: 'right' });
    doc.save().lineWidth(0.5).strokeColor('#e5e7eb').dash(2, { space: 2 }).moveTo(tx, yy + 20).lineTo(R, yy + 20).stroke().restore();
  };
  let ly = y;
  const next = (label, value, opts) => { line(label, ly, value, opts); ly += 28; };
  next('Total Boxes:', formatBoxes(bill.total_boxes), { money: false });
  next('Total Pieces:', formatPcs(bill.total_pcs), { money: false });
  next('Total Quantity (Dzn):', bill.total_dzn, { money: false });
  next('Subtotal:', bill.subtotal);
  if (bill.packing_deduction > 0) next('Less: Packing charges:', bill.packing_deduction, { minus: true });
  if (bill.round_off) next('Round off:', Math.abs(bill.round_off), { minus: bill.round_off < 0, plus: bill.round_off > 0 });
  doc.save().lineWidth(0.8).strokeColor('#9ca3af').moveTo(tx, ly - 6).lineTo(R, ly - 6).stroke().restore();
  text('GRAND TOTAL:', tx, ly + 10, { f: 'B', size: 14, width: (R - tx) * 0.58, align: 'right', color: NAVY });
  money(bill.grand_total, R, ly + 8, { size: 16, color: NAVY });
  if (bill.gst_percent > 0) text(`${bill.gst_percent}% GST included`, tx, ly + 32, { size: 9, width: R - tx, align: 'right', color: SOFT });

  const sy = Math.max(ty, ly + 46) + 40;
  labelled('Made by:', bill.made_by, L, sy, { size: 9.5, width: (R - L) * 0.5, bold: true });
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
  const [settings, products, names] = await Promise.all([getSettings(), sheetsService.read('Products'), adminNamesByMobile()]);
  const productSkus = Object.fromEntries(products.map((p) => [p.product_id, p.sku]));
  const bill = buildBill({
    order: bundle.order, items: activeItems(bundle.items, bundle.order.order_id), settings, productSkus, names,
  });
  return { bill, pdf: await renderBillPdf(bill), filename: billFileName(bill) };
}

/**
 * Packing slip for the packing person: the bill's articles, colours and
 * size-wise quantities with the customer's address - no rate, no amount.
 */
export async function packingSlip(idOrNumber, { packerName } = {}) {
  const bundle = await loadOrderBundle(idOrNumber, { byId: true });
  const [settings, products, names] = await Promise.all([getSettings(), sheetsService.read('Products'), adminNamesByMobile()]);
  const productSkus = Object.fromEntries(products.map((p) => [p.product_id, p.sku]));
  const { order } = bundle;
  const bill = buildBill({
    order, items: activeItems(bundle.items, order.order_id), settings, productSkus, names,
  });
  const notes = [
    order.order_notes && `Customer note: ${String(order.order_notes).trim()}`,
    order.less_packing === true && 'Customer chose "less packing charges".',
    order.customer_type_snapshot === 'EXISTING' ? 'Existing customer.' : '',
  ].filter(Boolean);
  const slip = {
    ...bill, slip: true, title: 'PACKING SLIP', packer_name: packerName ?? order.packer_name ?? '', notes,
  };
  return { slip, pdf: await renderBillPdf(slip), filename: `Packing_slip_${bill.number}.pdf` };
}

export async function customerBill(orderNumber, token) {
  const bundle = await loadOrderBundle(orderNumber);
  authorizeOrder(bundle.order, token);
  if (!billAvailable(bundle.order)) {
    throw conflict('BILL_NOT_READY', 'There is no bill for a cancelled order.');
  }
  return billFor(bundle);
}

export async function adminBill(idOrNumber) {
  const bundle = await loadOrderBundle(idOrNumber, { byId: true });
  return billFor(bundle);
}
