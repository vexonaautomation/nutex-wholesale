import { createMasterService } from './masterDataService.js';
import { AUDIT_ACTION } from '../config/constants.js';
import { ID_PREFIX } from '../utils/idGenerator.js';
import { badRequest } from '../utils/errors.js';

export const sizeService = createMasterService({
  sheet: 'Sizes',
  idField: 'size_id',
  idPrefix: ID_PREFIX.size,
  entity: 'Size',
  nameField: 'size_name',
  actions: {
    created: AUDIT_ACTION.SIZE_CREATED,
    updated: AUDIT_ACTION.SIZE_UPDATED,
    deactivated: AUDIT_ACTION.SIZE_DEACTIVATED,
    reactivated: AUDIT_ACTION.SIZE_REACTIVATED,
  },
  async prepare(input, { rows, existing }) {
    const others = rows.filter((r) => !existing || r.size_id !== existing.size_id);
    if (others.some((r) => r.size_name.toLowerCase() === input.size_name.toLowerCase())) {
      throw badRequest('This size already exists.');
    }
    const fields = { size_name: input.size_name };
    // a NEW number size (e.g. 28) goes before the next bigger number size,
    // so product pages show 28, 30, 32 ... instead of adding it at the end
    const num = /^\d+$/.test(String(input.size_name).trim()) ? Number(input.size_name) : null;
    if (!existing && num !== null) {
      const next = others
        .filter((r) => /^\d+$/.test(String(r.size_name).trim()) && Number(r.size_name) > num)
        .sort((a, b) => Number(a.size_name) - Number(b.size_name))[0];
      if (next) {
        const nextSort = Number(next.sort_order) || 0;
        const below = others.map((r) => Number(r.sort_order) || 0).filter((s) => s < nextSort);
        fields.sort_order = below.length ? (Math.max(...below) + nextSort) / 2 : nextSort - 10;
      }
    }
    return fields;
  },
});
