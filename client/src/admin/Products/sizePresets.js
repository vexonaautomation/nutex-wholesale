// Nutex size ranges: bras and sets start at 28, panties at 32. These only
// pre-tick sizes - any other (custom) size can always be ticked or added.
export const SIZE_PRESETS = [
  { key: 'bra', label: 'Bra & Set', from: 28, to: 40 },
  { key: 'panty', label: 'Panty', from: 32, to: 40 },
];

/** Active sizes whose number lies in the preset range (master order). */
export function presetSizeIds(sizes, key) {
  const p = SIZE_PRESETS.find((x) => x.key === key);
  if (!p) return [];
  return sizes
    .filter((s) => s.status === 'ACTIVE' && /^\d+$/.test(String(s.size_name).trim()))
    .filter((s) => Number(s.size_name) >= p.from && Number(s.size_name) <= p.to)
    .map((s) => s.size_id);
}

/** Which preset fits a category (by name / slug), or null. */
export function presetForCategory(category) {
  const text = `${category?.category_name || ''} ${category?.slug || ''}`.toLowerCase();
  if (/pant(y|ies)/.test(text)) return 'panty';
  if (/\bbra\b|bras?\b|\bset\b|lingerie/.test(text)) return 'bra';
  return null;
}
