import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadCart, saveCart } from '../services/cart.js';
import { orderApi } from '../services/order.js';
import { useCustomer } from './CustomerContext.jsx';

const CartContext = createContext(null);

/**
 * Cart = list of { variant_id, product_id, qty } in the browser.
 * Every change triggers a SERVER quote (debounced) that recalculates prices,
 * discount slab, minimum order and stock. In "edit order" mode the quote is
 * computed against the existing unpaid order (its own reservations count).
 */
export function CartProvider({ children }) {
  const [cart, setCart] = useState(loadCart);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reqId = useRef(0);
  // re-quote whenever the customer logs in/out as an existing customer
  const customerToken = useCustomer()?.auth?.token || '';

  useEffect(() => saveCart(cart), [cart]);

  // keep tabs in sync
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'nutex_cart_v1') setCart(loadCart());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const refreshQuote = useCallback(async (current = cart) => {
    const id = (reqId.current += 1);
    if (!current.items.length && !current.editing) {
      setQuote(null);
      setQuoting(false);
      return null;
    }
    setQuoting(true);
    try {
      const items = current.items.map(({ variant_id, qty }) => ({ variant_id, qty }));
      const q = current.editing
        ? (await orderApi.recalculate(current.editing.order_number, items)).quote
        : await orderApi.quote(items);
      if (id === reqId.current) {
        setQuote(q);
        setQuoteError(null);
      }
      return q;
    } catch (err) {
      if (id === reqId.current) setQuoteError(err);
      return null;
    } finally {
      if (id === reqId.current) setQuoting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, customerToken]);

  useEffect(() => {
    const t = setTimeout(() => refreshQuote(cart), 250);
    return () => clearTimeout(t);
  }, [cart, refreshQuote]);

  const addItems = useCallback((lines) => {
    setCart((c) => {
      const items = c.items.map((i) => ({ ...i }));
      for (const l of lines) {
        if (!l.qty) continue;
        const found = items.find((i) => i.variant_id === l.variant_id);
        if (found) found.qty += l.qty;
        else items.push({ variant_id: l.variant_id, product_id: l.product_id, qty: l.qty });
      }
      return { ...c, items };
    });
  }, []);

  const setQty = useCallback((variantId, qty) => {
    const q = Math.max(0, Math.floor(Number(qty) || 0));
    setCart((c) => ({
      ...c,
      items: q > 0 ? c.items.map((i) => (i.variant_id === variantId ? { ...i, qty: q } : i)) : c.items.filter((i) => i.variant_id !== variantId),
    }));
  }, []);

  const removeItem = useCallback((variantId) => {
    setCart((c) => ({ ...c, items: c.items.filter((i) => i.variant_id !== variantId) }));
  }, []);

  // change size / colour / box of a cart line
  const changeVariant = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    setCart((c) => {
      const from = c.items.find((i) => i.variant_id === fromId);
      if (!from) return c;
      const rest = c.items.filter((i) => i.variant_id !== fromId).map((i) => ({ ...i }));
      const existing = rest.find((i) => i.variant_id === toId);
      if (existing) existing.qty += from.qty;
      else rest.push({ ...from, variant_id: toId });
      return { ...c, items: rest };
    });
  }, []);

  const clear = useCallback(() => setCart({ items: [], editing: null }), []);

  const startEditOrder = useCallback((order) => {
    setCart({
      items: order.items.map((i) => ({ variant_id: i.variant_id, product_id: i.product_id, qty: i.qty })),
      editing: { order_number: order.order_number },
    });
  }, []);

  const stopEditing = useCallback(() => setCart({ items: [], editing: null }), []);

  const value = useMemo(() => ({
    items: cart.items,
    editing: cart.editing,
    count: cart.items.reduce((s, i) => s + i.qty, 0),
    lines: cart.items.length,
    quote,
    quoting,
    quoteError,
    refreshQuote: () => refreshQuote(cart),
    addItems,
    setQty,
    removeItem,
    changeVariant,
    clear,
    startEditOrder,
    stopEditing,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  }), [cart, quote, quoting, quoteError, refreshQuote, addItems, setQty, removeItem, changeVariant, clear, startEditOrder, stopEditing, drawerOpen]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
