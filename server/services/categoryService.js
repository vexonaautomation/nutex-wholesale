import { createMasterService } from './masterDataService.js';
import { AUDIT_ACTION } from '../config/constants.js';
import { ID_PREFIX } from '../utils/idGenerator.js';
import { slugify, uniqueSlug } from '../utils/slug.js';
import { badRequest } from '../utils/errors.js';

const driveViewUrl = (id) => (id ? `https://drive.google.com/file/d/${id}/view` : '');

export const categoryService = createMasterService({
  sheet: 'Categories',
  idField: 'category_id',
  idPrefix: ID_PREFIX.category,
  entity: 'Category',
  nameField: 'category_name',
  actions: {
    created: AUDIT_ACTION.CATEGORY_CREATED,
    updated: AUDIT_ACTION.CATEGORY_UPDATED,
    deactivated: AUDIT_ACTION.CATEGORY_DEACTIVATED,
    reactivated: AUDIT_ACTION.CATEGORY_REACTIVATED,
    archived: AUDIT_ACTION.CATEGORY_ARCHIVED,
  },
  async prepare(input, { rows, existing }) {
    const others = rows.filter((r) => !existing || r.category_id !== existing.category_id);
    const nameTaken = others.some((r) => r.category_name.toLowerCase() === input.category_name.toLowerCase());
    if (nameTaken) throw badRequest('A category with this name already exists.');
    const taken = new Set(others.map((r) => r.slug));
    let slug = slugify(input.slug || '');
    if (slug) {
      if (taken.has(slug)) throw badRequest('This URL slug is already used by another category.');
    } else {
      slug = existing?.slug || uniqueSlug(input.category_name, taken);
    }
    return {
      category_name: input.category_name,
      parent_category: input.parent_category || '',
      slug,
      description: input.description || '',
      image_file_id: input.image_file_id || '',
      image_url: driveViewUrl(input.image_file_id),
      seo_title: input.seo_title || '',
      seo_description: input.seo_description || '',
    };
  },
});
