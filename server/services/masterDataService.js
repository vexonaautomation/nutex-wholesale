import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { newId } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';
import { notFound, badRequest } from '../utils/errors.js';
import { RECORD_STATUS } from '../config/constants.js';

/**
 * Generic, safe CRUD for master-data sheets (Categories, Colors, Sizes).
 * - create  -> appends one row
 * - update  -> changes only the modified cells of that one row
 * - status  -> ACTIVE / INACTIVE / ARCHIVED (rows are never deleted)
 * - reorder -> updates sort_order cells only where they changed
 * Every change is written atomically together with its Audit_Log entry.
 */
export function createMasterService({ sheet, idField, idPrefix, entity, nameField, actions, prepare }) {
  async function list() {
    const rows = await sheetsService.read(sheet);
    return [...rows].sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a[nameField]).localeCompare(String(b[nameField])));
  }

  async function get(id) {
    const rows = await sheetsService.read(sheet, { fresh: true });
    const row = rows.find((r) => r[idField] === id);
    if (!row) throw notFound(`${entity} not found.`);
    return row;
  }

  async function create(input, { admin, ip }) {
    const rows = await sheetsService.read(sheet, { fresh: true });
    const fields = await prepare(input, { rows, existing: null });
    const now = nowIso();
    const maxSort = rows.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0);
    const row = {
      [idField]: newId(idPrefix),
      ...fields,
      status: input.status || RECORD_STATUS.ACTIVE,
      sort_order: input.sort_order ?? fields.sort_order ?? maxSort + 10,
      created_at: now,
      updated_at: now,
    };
    await sheetsService.commit([
      { op: 'append', sheet, rows: [row] },
      auditOp({ admin, ip, action: actions.created, entity_type: entity, entity_id: row[idField], new_value: row }),
    ]);
    return row;
  }

  async function update(id, input, { admin, ip }) {
    const rows = await sheetsService.read(sheet, { fresh: true });
    const existing = rows.find((r) => r[idField] === id);
    if (!existing) throw notFound(`${entity} not found.`);
    const fields = await prepare(input, { rows, existing });
    if (input.status) fields.status = input.status;
    if (input.sort_order !== undefined) fields.sort_order = input.sort_order;
    const patch = {};
    const oldValues = {};
    for (const [k, v] of Object.entries(fields)) {
      if (String(existing[k] ?? '') !== String(v ?? '')) {
        patch[k] = v;
        oldValues[k] = existing[k];
      }
    }
    if (!Object.keys(patch).length) return existing;
    patch.updated_at = nowIso();
    await sheetsService.commit([
      { op: 'update', sheet, id, patch },
      auditOp({ admin, ip, action: actions.updated, entity_type: entity, entity_id: id, old_value: oldValues, new_value: patch }),
    ]);
    return { ...existing, ...patch };
  }

  async function setStatus(id, status, { admin, ip }) {
    if (!Object.values(RECORD_STATUS).includes(status)) throw badRequest('Invalid status');
    const existing = await get(id);
    if (existing.status === status) return existing;
    const action = status === RECORD_STATUS.ACTIVE ? actions.reactivated
      : status === RECORD_STATUS.ARCHIVED ? (actions.archived || actions.deactivated)
        : actions.deactivated;
    const patch = { status, updated_at: nowIso() };
    await sheetsService.commit([
      { op: 'update', sheet, id, patch },
      auditOp({ admin, ip, action, entity_type: entity, entity_id: id, old_value: { status: existing.status }, new_value: { status } }),
    ]);
    return { ...existing, ...patch };
  }

  async function reorder(ids, { admin, ip }) {
    const rows = await sheetsService.read(sheet, { fresh: true });
    const byId = new Map(rows.map((r) => [r[idField], r]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) throw badRequest(`Unknown ${entity} IDs: ${unknown.join(', ')}`);
    const now = nowIso();
    const ops = [];
    const changes = {};
    ids.forEach((id, i) => {
      const sort = (i + 1) * 10;
      if (Number(byId.get(id).sort_order) !== sort) {
        ops.push({ op: 'update', sheet, id, patch: { sort_order: sort, updated_at: now } });
        changes[id] = sort;
      }
    });
    if (!ops.length) return { updated: 0 };
    ops.push(auditOp({ admin, ip, action: actions.updated, entity_type: entity, entity_id: 'reorder', new_value: changes, notes: 'Reordered' }));
    await sheetsService.commit(ops);
    return { updated: Object.keys(changes).length };
  }

  return { list, get, create, update, setStatus, reorder };
}
