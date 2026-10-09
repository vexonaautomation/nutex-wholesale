// Nutex size ranges: bras and sets 28-40 (some up to 44), panties 32-44. These only
// pre-tick sizes - any other (custom) size can always be ticked or added.
export const SIZE_PRESETS = [
  { key: 'bra', label: 'Bra & Set', from: 28, to: 40 },
  { key: 'panty', label: 'Panty', from: 32, to: 44 },
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

/** Sizes of a preset (28, 30 ... 40) that are not in the size list at all yet. */
export function missingPresetSizes(sizes, key) {
  const p = SIZE_PRESETS.find((x) => x.key === key);
  if (!p) return [];
  const have = new Set(sizes.map((s) => String(s.size_name).trim()));
  const out = [];
  for (let n = p.from; n <= p.to; n += 2) if (!have.has(String(n))) out.push(String(n));
  return out;
}
