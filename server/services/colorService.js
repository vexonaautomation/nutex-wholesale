import { createMasterService } from './masterDataService.js';
import { AUDIT_ACTION } from '../config/constants.js';
import { ID_PREFIX } from '../utils/idGenerator.js';
import { badRequest } from '../utils/errors.js';

export const colorService = createMasterService({
  sheet: 'Colors',
  idField: 'color_id',
  idPrefix: ID_PREFIX.color,
  entity: 'Color',
  nameField: 'color_name',
  actions: {
    created: AUDIT_ACTION.COLOR_CREATED,
    updated: AUDIT_ACTION.COLOR_UPDATED,
    deactivated: AUDIT_ACTION.COLOR_DEACTIVATED,
    reactivated: AUDIT_ACTION.COLOR_REACTIVATED,
  },
  async prepare(input, { rows, existing }) {
    const others = rows.filter((r) => !existing || r.color_id !== existing.color_id);
    if (others.some((r) => r.color_name.toLowerCase() === input.color_name.toLowerCase())) {
      throw badRequest('A color with this name already exists.');
    }
    const code = (input.color_code || input.color_name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)).toUpperCase();
    if (others.some((r) => r.color_code && r.color_code.toUpperCase() === code)) {
      throw badRequest(`Color code ${code} is already used. Enter a different color code.`);
    }
    return {
      color_name: input.color_name,
      color_code: code,
      hex_code: (input.hex_code || '').toUpperCase(),
      swatch_image: input.swatch_image || '',
    };
  },
});
