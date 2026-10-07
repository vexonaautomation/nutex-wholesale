import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { SCHEMA } from '../config/schema.js';
import { AUDIT_ACTION } from '../config/constants.js';
import { toCsv } from '../utils/csv.js';
import { badRequest } from '../utils/errors.js';

// Read-only CSV export of any sheet (backup / analysis).
// Sensitive columns are excluded.
const EXCLUDED = { Admin_Users: ['password_hash'] };

export async function exportSheet(sheet, { admin, ip }) {
  if (!SCHEMA[sheet]) throw badRequest('Unknown sheet');
  const rows = await sheetsService.read(sheet, { fresh: true });
  const columns = SCHEMA[sheet].columns.filter((c) => !(EXCLUDED[sheet] || []).includes(c));
  await sheetsService.commit([auditOp({ admin, ip, action: AUDIT_ACTION.DATA_EXPORTED, entity_type: 'Sheet', entity_id: sheet, new_value: { rows: rows.length } })]);
  return { filename: `nutex-${sheet.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(columns, rows) };
}

export function exportableSheets() {
  return Object.keys(SCHEMA);
}
