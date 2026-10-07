import { sheetsService } from './sheetsService.js';
import { auditOp } from './auditService.js';
import { INITIAL_MASTER_DATA } from '../config/defaults.js';
import { AUDIT_ACTION, RECORD_STATUS } from '../config/constants.js';
import { newId, ID_PREFIX } from '../utils/idGenerator.js';
import { nowIso } from '../utils/dates.js';

/**
 * Loads Nutex's real starting master data (10 categories, standard sizes,
 * basic colors). Explicitly triggered by an admin - never at startup.
 * Each sheet is filled ONLY if it is completely empty; nothing existing is
 * modified, so running it twice is harmless.
 */
export async function initializeMasterData({ admin, ip } = {}) {
  const data = await sheetsService.readMany(['Categories', 'Sizes', 'Colors'], { fresh: true });
  const now = nowIso();
  const ops = [];
  const result = { categories: 0, sizes: 0, colors: 0, skipped: [] };

  if (!data.Categories.length) {
    const rows = INITIAL_MASTER_DATA.categories.map((c, i) => ({
      category_id: newId(ID_PREFIX.category), category_name: c.category_name, parent_category: c.parent_category,
      slug: c.slug, description: '', image_file_id: '', image_url: '', status: RECORD_STATUS.ACTIVE,
      sort_order: (i + 1) * 10, seo_title: '', seo_description: '', created_at: now, updated_at: now,
    }));
    ops.push({ op: 'append', sheet: 'Categories', rows });
    result.categories = rows.length;
  } else result.skipped.push('Categories (already has data)');

  if (!data.Sizes.length) {
    const rows = INITIAL_MASTER_DATA.sizes.map((s, i) => ({
      size_id: newId(ID_PREFIX.size), size_name: s, sort_order: (i + 1) * 10, status: RECORD_STATUS.ACTIVE, created_at: now, updated_at: now,
    }));
    ops.push({ op: 'append', sheet: 'Sizes', rows });
    result.sizes = rows.length;
  } else result.skipped.push('Sizes (already has data)');

  if (!data.Colors.length) {
    const rows = INITIAL_MASTER_DATA.colors.map((c, i) => ({
      color_id: newId(ID_PREFIX.color), color_name: c.color_name, color_code: c.color_code, hex_code: c.hex_code,
      swatch_image: '', status: RECORD_STATUS.ACTIVE, sort_order: (i + 1) * 10, created_at: now, updated_at: now,
    }));
    ops.push({ op: 'append', sheet: 'Colors', rows });
    result.colors = rows.length;
  } else result.skipped.push('Colors (already has data)');

  if (ops.length) {
    ops.push(auditOp({ admin, ip, action: AUDIT_ACTION.MASTER_DATA_INITIALIZED, entity_type: 'MasterData', entity_id: 'initial', new_value: result }));
    await sheetsService.commit(ops);
  }
  return result;
}
