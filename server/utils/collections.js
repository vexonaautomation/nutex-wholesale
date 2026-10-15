// Product collections: groups of articles with their own page (e.g. the
// "Online Collection" at /online). An article keeps its category; a
// collection is an extra tag in Products.collections (comma separated slugs).

export const COLLECTIONS = Object.freeze({
  online: { slug: 'online', name: 'Online Collection' },
});

export const isCollection = (slug) => Object.prototype.hasOwnProperty.call(COLLECTIONS, String(slug || '').toLowerCase());

export function collectionsOf(product) {
  return String(product?.collections || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Sheet value: known collections only, no duplicates, comma separated. */
export function joinCollections(list) {
  return [...new Set((list || []).map((s) => String(s).trim().toLowerCase()).filter(isCollection))].join(',');
}
