// Which inventory rows - and how many pieces of each - ONE unit of an order
// line uses:
//   * loose pieces / pre-packed boxes: its own inventory row, 1 per unit
//   * auto box (no box stock entered): perColour pieces of every colour of
//     that size, e.g. box of 3 with Orange/Pink/Green = 1 + 1 + 1
// Saved on Order_Items.stock_components at order time, so reserving,
// deducting, releasing and reopening always move exactly the same pieces -
// even if colours or box stock are changed later.

/** { inventoryVariantId: piecesPerUnit } for a quote line or an Order_Items row. */
export function componentsOf(line) {
  const raw = line?.stock_components;
  let parsed = null;
  if (raw && typeof raw === 'object') parsed = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  const valid = parsed && typeof parsed === 'object' && Object.keys(parsed).length
    && Object.values(parsed).every((n) => Number(n) > 0);
  if (!valid) return { [line.variant_id]: 1 };
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, Number(v)]));
}

/** Total pieces per inventory variant used by these lines (qty x pieces per unit). */
export function piecesByInventory(lines) {
  const out = {};
  for (const l of lines) {
    const qty = Number(l.qty) || 0;
    if (!qty) continue;
    for (const [v, per] of Object.entries(componentsOf(l))) out[v] = (out[v] || 0) + qty * per;
  }
  return out;
}

/** Sheet value: blank for the normal "own row, 1 per unit" case, else JSON. */
export function encodeComponents(line) {
  const c = line?.stock_components;
  if (!c || typeof c !== 'object') return '';
  const keys = Object.keys(c);
  if (keys.length === 1 && keys[0] === line.variant_id && Number(c[keys[0]]) === 1) return '';
  return JSON.stringify(c);
}
