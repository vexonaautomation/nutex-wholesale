// Mix boxes (same rule as the server, server/utils/stockValidator.js): a box
// takes the same pieces of every colour of its size; the rest (pieces per box
// % colours) are the extra pieces - all of the product's extra colour (default
// Black), or with "most stock" from different colours, at most 1 extra of a
// colour per box.

export const EXTRA_COLOUR_AUTO = 'AUTO';

/** Index of the colour giving the extra pieces (-1 = colours with the most stock). */
export function extraColourIndex(colours, pref) {
  const p = String(pref || '').trim();
  if (p.toUpperCase() === EXTRA_COLOUR_AUTO) return -1;
  const chosen = p ? colours.findIndex((c) => c.color_id === p) : -1;
  if (chosen >= 0) return chosen;
  return colours.findIndex((c) => String(c.color_name || '').trim().toLowerCase() === 'black');
}

/** Most boxes that can be packed from these pieces per colour (`fixed` = index of the extra colour, -1 = most stock). */
export function maxMixBoxes(stocks, base, extra, fixed = -1) {
  const units = base * stocks.length + extra;
  if (!units || !stocks.length) return 0;
  if (fixed >= 0 && fixed < stocks.length) {
    return Math.max(0, Math.min(...stocks.map((x, i) => Math.floor(Math.max(0, x) / (base + (i === fixed ? extra : 0)) || 0))));
  }
  const total = stocks.reduce((s, x) => s + Math.max(0, x), 0);
  const fits = (b) => stocks.every((x) => x >= base * b)
    && stocks.reduce((s, x) => s + Math.min(x - base * b, b), 0) >= extra * b;
  let lo = 0;
  let hi = Math.floor(total / units);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** "2 of each colour", "1 of each colour + 1 Black", "1 of each colour + 1 mixed", "3 pcs from different colours". */
export function mixText(perColour, extra, extraColour = '') {
  if (!perColour) return `${extra} pcs from different colours`;
  return `${perColour} of each colour${extra ? ` + ${extra} ${extraColour || 'mixed'}` : ''}`;
}
