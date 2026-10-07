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
    return { size_name: input.size_name };
  },
});
