// Existing customers with Excel: download the template (blank or filled with
// the current list), fill it in Excel, upload it -> preview -> apply.
// Excel keeps numbers as numbers (9876543210 -> 9.88E+09, 302001.0, a leading
// "+91 "...), so every cell is read back as clean text before it is checked.
import ExcelJS from 'exceljs';
import { sheetsService } from './sheetsService.js';
import { addExistingCustomers, fieldOfHeader, EXAMPLE_ROW_MARK } from './existingCustomerService.js';
import { badRequest } from '../utils/errors.js';

const SHEET = 'Customers';
const COLUMNS = [
  ['mobile', 'mobile (required)', 16],
  ['customer_name', 'customer_name', 22],
  ['business_name', 'business_name', 26],
  ['alternate_mobiles', 'alternate_mobiles', 24],
  ['address', 'address', 40],
  ['city', 'city', 16],
  ['state', 'state', 20],
  ['pincode', 'pincode', 10],
  ['gstin', 'gstin', 18],
  ['minimum_order_value', 'minimum_order_value', 14],
  ['notes', 'notes', 26],
];
// typed as text in Excel so numbers are kept exactly as written
const TEXT_COLUMNS = ['mobile', 'alternate_mobiles', 'pincode', 'gstin'];
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
const MAX_ROWS = 3000;

/** The .xlsx to fill in: "Customers" (+ the current list when asked), "How to fill", "Lists". */
export async function existingCustomersWorkbook({ withCustomers = false } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nutex Wholesale';
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET);
  ws.columns = COLUMNS.map(([key, header, width]) => ({ key, header, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5A1A3A' } };
  head.alignment = { vertical: 'middle' };
  head.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const key of TEXT_COLUMNS) ws.getColumn(key).numFmt = '@';

  if (withCustomers) {
    const rows = await sheetsService.read('Existing_Customers', { fresh: true });
    for (const r of rows.filter((x) => String(x.status || 'ACTIVE').toUpperCase() !== 'INACTIVE')) {
      ws.addRow({
        mobile: String(r.mobile || ''),
        customer_name: r.customer_name || '',
        business_name: r.business_name || '',
        alternate_mobiles: r.alternate_mobiles || '',
        address: r.address || '',
        city: r.city || '',
        state: r.state || '',
        pincode: r.pincode ? String(r.pincode) : '',
        gstin: r.gstin || '',
        minimum_order_value: r.minimum_order_value ?? '',
        notes: r.notes || '',
      });
    }
  }
  // state dropdown (typing another name is still allowed)
  const last = Math.max(ws.rowCount, 1) + MAX_ROWS;
  ws.dataValidations.add(`G2:G${last}`, {
    type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`Lists!$A$2:$A$${INDIAN_STATES.length + 1}`],
  });

  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 24;
  help.getColumn(2).width = 90;
  const lines = [
    ['Existing customers - how to fill', ''],
    ['', ''],
    ['1 row = 1 customer', 'Fill the "Customers" sheet. Only "mobile" is required, all other columns are optional.'],
    ['mobile', '10-digit mobile number, e.g. 9876543210 (+91, spaces or a leading 0 are fine).'],
    ['customer_name', 'Name of the person.'],
    ['business_name', 'Shop / firm name (printed as Party Name on the bill).'],
    ['alternate_mobiles', 'Other numbers of the same customer, separated by a comma, e.g. 9123456789, 9988776655 (max 5).'],
    ['address', 'Shop / street address. Commas are fine.'],
    ['city / state / pincode', 'State: pick from the list. Pincode: 6 digits.'],
    ['gstin', '15-character GST number (leave blank if none).'],
    ['minimum_order_value', 'Only if this customer has a different minimum order (in Rs). Blank = normal.'],
    ['notes', 'Anything for your team.'],
    ['', ''],
    ['A number already in the list', 'Gets the details you filled in. Empty columns keep what is already saved.'],
    ['Upload', 'Admin > Existing Customers > Import from Excel > upload this file. You see every row first (new / updated / errors with the row number) and then click Apply.'],
    ['Example row', '9876543210 | Riya Sharma | Riya Fashion | 9123456789 | 12 MG Road, Shop 4 | Pune | Maharashtra | 411001 | 27ABCDE1234F1Z5'],
  ];
  for (const [a, b] of lines) help.addRow([a, b]);
  help.getRow(1).font = { bold: true, size: 14 };
  for (let i = 3; i <= lines.length; i += 1) help.getCell(`A${i}`).font = { bold: true };

  const ls = wb.addWorksheet('Lists');
  ls.getColumn(1).width = 34;
  ls.addRow(['States']);
  ls.getRow(1).font = { bold: true };
  for (const s of INDIAN_STATES) ls.addRow([s]);

  const date = new Date().toISOString().slice(0, 10);
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    filename: withCustomers ? `nutex-existing-customers-${date}.xlsx` : 'nutex-existing-customers-template.xlsx',
  };
}

/** Clean text of one Excel cell: numbers without ".0" / E+09, formulas, links, rich text. */
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result);
    if (value.richText) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return cellText(value.text);
    if (value.hyperlink) return String(value.hyperlink).replace(/^tel:/, '');
    return '';
  }
  return String(value).trim();
}

/** Rows of the uploaded workbook as { _row, mobile, customer_name, ... }. */
export async function readExistingCustomersFile(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw badRequest('This is not an Excel (.xlsx) file. Download the template, fill it and upload it again.');
  }
  const ws = wb.getWorksheet(SHEET) || wb.worksheets.find((w) => w.name !== 'How to fill' && w.name !== 'Lists');
  if (!ws) throw badRequest('The "Customers" sheet is missing - use the downloaded template.');
  const fields = {};
  ws.getRow(1).eachCell((cell, col) => {
    const f = fieldOfHeader(cellText(cell.value)) || (normalizedKey(cellText(cell.value)) in KEYS ? KEYS[normalizedKey(cellText(cell.value))] : null);
    if (f && !Object.values(fields).includes(f)) fields[col] = f;
  });
  if (!Object.values(fields).includes('mobile')) throw badRequest('No "mobile" column found in row 1 - use the downloaded template.');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, number) => {
    if (number === 1) return;
    const out = { _row: number };
    for (const [col, f] of Object.entries(fields)) out[f] = cellText(row.getCell(Number(col)).value);
    if (!Object.entries(out).some(([k, v]) => k !== '_row' && v)) return; // empty row
    if (String(out.notes || '').toUpperCase().startsWith(EXAMPLE_ROW_MARK)) return;
    rows.push(out);
  });
  if (rows.length > MAX_ROWS) throw badRequest(`Maximum ${MAX_ROWS} customers per file.`);
  return rows;
}
// template headers are field keys ("customer_name") - also accepted as they are
const KEYS = Object.fromEntries(COLUMNS.map(([key]) => [key.replace(/_/g, ' '), key]));
const normalizedKey = (h) => String(h || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[_\-.*:]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Preview (nothing written) or apply an uploaded file. */
export async function importExistingCustomersFile(buffer, { apply = false, admin, ip }) {
  const rows = await readExistingCustomersFile(buffer);
  if (!rows.length) throw badRequest('The file has no customers - fill at least one row with a mobile number.');
  const res = await addExistingCustomers(rows, { admin, ip }, { dryRun: !apply });
  return {
    applied: apply,
    rows: rows.length,
    add: res.report.add,
    update: res.report.update,
    unchanged: res.report.unchanged,
    errors: res.report.errors,
  };
}
