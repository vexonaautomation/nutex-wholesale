import { sheetsService } from './sheetsService.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { ACTOR } from '../config/constants.js';

const SHEET = 'Audit_Log';

const serialize = (v) => {
  if (v === undefined || v === null || v === '') return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
};

/**
 * Builds an Audit_Log append operation. Callers include it in the SAME
 * sheetsService.commit() as the change itself, so the change and its audit
 * record are written atomically.
 */
export function auditOp({ admin, actorType, action, entity_type, entity_id, old_value, new_value, reason, notes, ip }) {
  return {
    op: 'append',
    sheet: SHEET,
    rows: [{
      audit_id: newId(ID_PREFIX.audit),
      timestamp: nowIso(),
      admin_id: admin?.admin_id || '',
      actor_type: actorType || (admin ? ACTOR.ADMIN : ACTOR.SYSTEM),
      action,
      entity_type: entity_type || '',
      entity_id: entity_id || '',
      old_value: serialize(old_value),
      new_value: serialize(new_value),
      reason: reason || '',
      notes: notes || (admin?.email ? `by ${admin.email}` : ''),
      ip: ip || '',
    }],
  };
}

export async function logAudit(entry) {
  await sheetsService.commit([auditOp(entry)]);
}

export async function listAudit({ action, entity_type, entity_id, q, from, to, page = 1, limit = 50 } = {}) {
  const rows = await sheetsService.read(SHEET);
  const needle = (q || '').toLowerCase();
  let filtered = rows.filter((r) => (!action || r.action === action)
    && (!entity_type || r.entity_type === entity_type)
    && (!entity_id || r.entity_id === entity_id)
    && (!from || r.timestamp >= from)
    && (!to || r.timestamp <= `${to}T23:59:59.999Z`)
    && (!needle || [r.entity_id, r.admin_id, r.notes, r.reason, r.new_value].some((v) => String(v).toLowerCase().includes(needle))));
  filtered = filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const size = Math.min(200, Math.max(1, Number(limit) || 50));
  const p = Math.max(1, Number(page) || 1);
  return {
    total: filtered.length,
    page: p,
    limit: size,
    items: filtered.slice((p - 1) * size, p * size),
    actions: [...new Set(rows.map((r) => r.action))].sort(),
  };
}
