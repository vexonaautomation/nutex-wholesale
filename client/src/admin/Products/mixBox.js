// Mix boxes (same rule as the server, server/utils/stockValidator.js): a box
// takes the same pieces of every colour of its size; the rest (pieces per box
// % colours) come from different colours - at most 1 extra of a colour per box.

/** Most boxes that can be packed from these pieces per colour. */
export function maxMixBoxes(stocks, base, extra) {
  const units = base * stocks.length + extra;
  if (!units || !stocks.length) return 0;
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

/** "2 of each colour", "1 of each colour + 1 mixed", "3 pcs from different colours". */
export function mixText(perColour, extra) {
  if (!perColour) return `${extra} pcs from different colours`;
  return `${perColour} of each colour${extra ? ` + ${extra} mixed` : ''}`;
}
