import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { AUDIT_ACTION, ORDER_STATUS } from '../config/constants.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso, istDate } from '../utils/dates.js';
import { badRequest, notFound, conflict } from '../utils/errors.js';
import { normalizeSlab, calculatePricing, getActiveSlabs } from './priceCalculator.js';
import { getSettings } from './settingsService.js';
import { formatINR } from '../utils/money.js';

const SHEET = 'Discount_Slabs';

// Whole-rupee inclusive ranges -> half-open [min, max+1)
const upper = (s) => (s.max_amount === null ? Infinity : s.max_amount + 1);
const amountsOverlap = (a, b) => a.min_amount < upper(b) && b.min_amount < upper(a);
const datesOverlap = (a, b) => (a.start_date || '0000-00-00') <= (b.end_date || '9999-12-31')
  && (b.start_date || '0000-00-00') <= (a.end_date || '9999-12-31');

/** Two ACTIVE slabs may not overlap in amount while their date windows overlap. */
export function findOverlaps(candidate, others) {
  if (!candidate.active) return [];
  return others
    .map(normalizeSlab)
    .filter((o) => o.active && !o.deleted && o.slab_id !== candidate.slab_id)
    .filter((o) => amountsOverlap(candidate, o) && datesOverlap(candidate, o));
}

const rangeText = (s) => `${formatINR(s.min_amount)} - ${s.max_amount === null ? 'and above' : formatINR(s.max_amount)}`;

export function slabWarnings(slabs, today = istDate()) {
  const active = getActiveSlabs(slabs, today);
  const warnings = [];
  if (!active.length) return ['No slab is currently active - in slab mode every cart gets 0% discount.'];
  if (active[0].min_amount > 0) warnings.push(`Carts below ${formatINR(active[0].min_amount)} do not fall in any slab and get 0% discount.`);
  for (let i = 1; i < active.length; i += 1) {
    const prev = active[i - 1];
    if (prev.max_amount !== null && prev.max_amount + 1 < active[i].min_amount) {
      warnings.push(`Gap between ${formatINR(prev.max_amount)} and ${formatINR(active[i].min_amount)} - carts in this range get 0% discount.`);
    }
    if (active[i].discount_percent < prev.discount_percent) {
      warnings.push(`Slab ${rangeText(active[i])} gives a LOWER discount than the slab below it.`);
    }
  }
  if (active[active.length - 1].max_amount !== null) {
    warnings.push(`Carts above ${formatINR(active[active.length - 1].max_amount)} do not fall in any slab. Leave the top slab's maximum blank for "and above".`);
  }
  return warnings;
}

export async function listSlabs() {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const slabs = rows.filter((r) => !r.deleted).map((r) => ({ ...r, ...normalizeSlab(r) }))
    .sort((a, b) => a.min_amount - b.min_amount || a.priority - b.priority);
  const settings = await getSettings();
  return {
    slabs,
    warnings: slabWarnings(rows),
    discount_mode: settings.discount_mode,
    discount_slab_basis: settings.discount_slab_basis,
    default_discount_percent: settings.default_discount_percent,
    minimum_order_value: settings.minimum_order_value,
  };
}

function toRow(input) {
  return {
    label: input.label || '',
    min_amount: input.min_amount,
    max_amount: input.max_amount,
    discount_percent: input.discount_percent,
    priority: input.priority,
    active: input.active,
    start_date: input.start_date || '',
    end_date: input.end_date || '',
  };
}

function assertNoOverlap(candidate, rows) {
  const overlaps = findOverlaps(normalizeSlab(candidate), rows);
  if (overlaps.length) {
    throw badRequest(
      `This slab overlaps with active slab(s): ${overlaps.map(rangeText).join('; ')}. Adjust the ranges, dates, or deactivate the other slab.`,
      overlaps.map((o) => ({ slab_id: o.slab_id, min_amount: o.min_amount, max_amount: o.max_amount })),
    );
  }
}

export async function createSlab(input, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const now = nowIso();
  const row = { slab_id: newId(ID_PREFIX.slab), ...toRow(input), deleted: false, created_at: now, updated_at: now };
  assertNoOverlap(row, rows);
  await sheetsService.commit([
    { op: 'append', sheet: SHEET, rows: [row] },
    auditOp({ admin, ip, action: AUDIT_ACTION.SLAB_CREATED, entity_type: 'Discount_Slab', entity_id: row.slab_id, new_value: row }),
  ]);
  return row;
}

export async function updateSlab(id, input, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const existing = rows.find((r) => r.slab_id === id && !r.deleted);
  if (!existing) throw notFound('Slab not found.');
  const next = { ...existing, ...toRow(input) };
  assertNoOverlap(next, rows);
  const patch = {};
  const old = {};
  for (const [k, v] of Object.entries(toRow(input))) {
    if (String(existing[k] ?? '') !== String(v ?? '')) {
      patch[k] = v;
      old[k] = existing[k];
    }
  }
  if (!Object.keys(patch).length) return existing;
  patch.updated_at = nowIso();
  const action = 'active' in patch && Object.keys(patch).length === 2
    ? (patch.active ? AUDIT_ACTION.SLAB_REACTIVATED : AUDIT_ACTION.SLAB_DEACTIVATED)
    : AUDIT_ACTION.SLAB_UPDATED;
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id, patch },
    auditOp({ admin, ip, action, entity_type: 'Discount_Slab', entity_id: id, old_value: old, new_value: patch }),
  ]);
  return { ...existing, ...patch };
}

export async function setSlabActive(id, active, { admin, ip }) {
  const rows = await sheetsService.read(SHEET, { fresh: true });
  const existing = rows.find((r) => r.slab_id === id && !r.deleted);
  if (!existing) throw notFound('Slab not found.');
  if (existing.active === active) return existing;
  if (active) assertNoOverlap({ ...existing, active: true }, rows);
  const patch = { active, updated_at: nowIso() };
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id, patch },
    auditOp({
      admin, ip, action: active ? AUDIT_ACTION.SLAB_REACTIVATED : AUDIT_ACTION.SLAB_DEACTIVATED,
      entity_type: 'Discount_Slab', entity_id: id, old_value: { active: existing.active }, new_value: { active },
    }),
  ]);
  return { ...existing, ...patch };
}

/**
 * "Delete if safe": allowed only when no order ever used the slab. Even then
 * the row is kept and flagged deleted=TRUE (soft delete) for auditability.
 */
export async function deleteSlab(id, { admin, ip }) {
  const data = await sheetsService.readMany([SHEET, 'Orders'], { fresh: true });
  const existing = data[SHEET].find((r) => r.slab_id === id && !r.deleted);
  if (!existing) throw notFound('Slab not found.');
  const used = data.Orders.filter((o) => o.slab_id_snapshot === id && o.order_status !== ORDER_STATUS.CANCELLED).length;
  if (used) throw conflict('SLAB_IN_USE', `This slab was applied to ${used} order(s) and cannot be deleted. Deactivate it instead.`);
  const patch = { deleted: true, active: false, updated_at: nowIso() };
  await sheetsService.commit([
    { op: 'update', sheet: SHEET, id, patch },
    auditOp({ admin, ip, action: AUDIT_ACTION.SLAB_DELETED, entity_type: 'Discount_Slab', entity_id: id, old_value: existing, new_value: patch }),
  ]);
  return { deleted: true };
}

// Admin calculator: "what would a cart worth X MRP pay right now?"
export async function previewSlabs(mrpAmount) {
  const [settings, slabs] = await Promise.all([getSettings(), sheetsService.read(SHEET)]);
  return calculatePricing({ lines: [{ key: 'preview', qty: 1, unit_mrp: mrpAmount }], settings, slabs });
}
