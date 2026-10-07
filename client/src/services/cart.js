// The cart is a browser-side convenience only. LOCAL STORAGE IS NOT THE
// DATABASE: prices/stock are always re-calculated by the server, and orders
// are only created in Google Sheets through the API.
const KEY = 'nutex_cart_v1';

export function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || !Array.isArray(raw.items)) return { items: [], editing: null };
    return {
      items: raw.items
        .filter((i) => i && typeof i.variant_id === 'string' && Number(i.qty) > 0)
        .map((i) => ({ variant_id: i.variant_id, product_id: i.product_id || '', qty: Math.floor(Number(i.qty)) })),
      editing: raw.editing && typeof raw.editing.order_number === 'string' ? raw.editing : null,
    };
  } catch {
    return { items: [], editing: null };
  }
}

export function saveCart(cart) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* storage unavailable (private mode) - cart lives in memory only */
  }
}
