import { useEffect, useMemo, useState } from 'react';
import { Boxes, Layers, Plus, Search, Trash2, X } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useDebounce } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Field, Spinner } from '../../components/common/ui.jsx';
import { QuantitySelector } from '../../components/QuantitySelector/QuantitySelector.jsx';
import { formatINR, pct } from '../../utils/format.js';

const sameLines = (a, b) => a.length === b.length && a.every((l, i) => l.variant_id === b[i].variant_id && l.qty === b[i].qty);

// what one line is, before / without a preview
const describe = (l) => [l.size_name || l.size ? `Size ${l.size_name || l.size}` : '', l.box_label || l.color_name || l.color || l.box || ''].filter(Boolean).join(' · ');

/**
 * Article search + Box / Pieces picker. Box is selected by default for every
 * customer; loose pieces only when the order's customer may buy them.
 */
function AddItems({ orderId, onAdd }) {
  const [q, setQ] = useState('');
  const query = useDebounce(q.trim(), 300);
  const [results, setResults] = useState({ q: '', products: [] });
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState(null);
  const [mode, setMode] = useState('BOX');
  const [qty, setQty] = useState({});
  const toast = useToast();

  useEffect(() => {
    if (query.length < 2) return undefined;
    let live = true;
    setSearching(true);
    adminApi.get(`/orders/${encodeURIComponent(orderId)}/product-options?q=${encodeURIComponent(query)}`)
      .then((res) => { if (live) setResults({ q: query, products: res.products }); })
      .catch((err) => { if (live) toast.error(err.message); })
      .finally(() => { if (live) setSearching(false); });
    return () => { live = false; };
  }, [orderId, query, toast]);

  const boxes = useMemo(() => (product?.options || []).filter((o) => o.box_label), [product]);
  const pieces = useMemo(() => (product?.options || []).filter((o) => !o.box_label), [product]);
  const grid = useMemo(() => {
    const colours = [];
    const sizes = [];
    const cell = {};
    for (const o of pieces) {
      if (!colours.some((c) => c.id === o.color_id)) colours.push({ id: o.color_id, name: o.color_name, hex: o.hex_code });
      if (!sizes.some((s) => s.id === o.size_id)) sizes.push({ id: o.size_id, name: o.size_name });
      cell[`${o.color_id}|${o.size_id}`] = o;
    }
    return { colours, sizes, cell };
  }, [pieces]);

  const choose = (p) => {
    setProduct(p);
    setQty({});
    const hasBox = p.options.some((o) => o.box_label);
    setMode(!hasBox && p.pcs_allowed ? 'PCS' : 'BOX');
  };
  const setOne = (id, value) => setQty((prev) => ({ ...prev, [id]: value }));
  const picked = Object.entries(qty).filter(([id, n]) => n > 0 && (mode === 'BOX' ? boxes : pieces).some((o) => o.variant_id === id));
  const add = () => {
    onAdd(picked.map(([variant_id, n]) => {
      const o = product.options.find((x) => x.variant_id === variant_id);
      return {
        variant_id, qty: n, product_name: product.product_name, sku: product.sku, size_name: o.size_name, color_name: o.color_name, box_label: o.box_label,
      };
    }));
    setProduct(null);
    setQty({});
  };

  const list = query.length >= 2 && results.q === query ? results.products : [];
  return (
    <div className="packing-box">
      <div className="small"><strong>Add an article</strong> <span className="muted">- search by SKU or name</span></div>
      {!product && (
        <>
          <div className="oe-search">
            <Search />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. YASHIKA or Comfort Bra" aria-label="Search article by SKU or name" autoFocus />
          </div>
          {searching && <div className="small muted"><Spinner small /> Searching…</div>}
          {!searching && query.length >= 2 && results.q === query && !list.length && <div className="small muted">No active article found for “{query}”.</div>}
          {list.length > 0 && (
            <div className="oe-results">
              {list.map((p) => (
                <button key={p.product_id} type="button" className="oe-result" onClick={() => choose(p)}>
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="oe-thumb" />}
                  <span><span className="cell-main">{p.product_name}</span><span className="cell-sub">SKU {p.sku}</span></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {product && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><div className="cell-main">{product.product_name}</div><div className="cell-sub">SKU {product.sku}</div></div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setProduct(null)}><X /> Change</button>
          </div>
          <div className="chips" role="group" aria-label="Buy as">
            <button type="button" className="chip" aria-pressed={mode === 'BOX'} disabled={!boxes.length} onClick={() => setMode('BOX')}><Boxes /> Box</button>
            <button type="button" className="chip" aria-pressed={mode === 'PCS'} disabled={!product.pcs_allowed || !pieces.length} onClick={() => setMode('PCS')}><Layers /> Loose pieces</button>
          </div>
          {!product.pcs_allowed && <div className="tiny soft">Loose pieces only for existing customers - this order is from a new customer.</div>}

          {mode === 'BOX' && (boxes.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Box</th><th className="right">Available</th><th className="right">Boxes</th></tr></thead>
                <tbody>
                  {boxes.map((o) => (
                    <tr key={o.variant_id}>
                      <td>{o.box_label}</td>
                      <td className="right num small">{o.purchasable ? o.available : 'Out of stock'}</td>
                      <td className="right"><QuantitySelector size="sm" value={qty[o.variant_id] || 0} max={o.purchasable ? o.available : 0} disabled={!o.purchasable} onChange={(v) => setOne(o.variant_id, v)} label={`Boxes of ${o.box_label}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="small muted">This article has no box.</div>)}

          {mode === 'PCS' && (
            <div className="table-wrap">
              <table className="table oe-grid">
                <thead><tr><th>Colour</th>{grid.sizes.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
                <tbody>
                  {grid.colours.map((c) => (
                    <tr key={c.id}>
                      <td className="nowrap"><span className="swatch-dot swatch-dot-sm" style={{ background: c.hex || '#ccc' }} /> {c.name}</td>
                      {grid.sizes.map((s) => {
                        const o = grid.cell[`${c.id}|${s.id}`];
                        if (!o) return <td key={s.id} />;
                        return (
                          <td key={s.id}>
                            <input
                              className="input oe-pcs"
                              type="number"
                              min={0}
                              max={o.available}
                              inputMode="numeric"
                              disabled={!o.purchasable}
                              placeholder={o.purchasable ? `≤${o.available}` : '—'}
                              value={qty[o.variant_id] || ''}
                              onChange={(e) => setOne(o.variant_id, Math.min(o.available, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
                              aria-label={`${c.name} size ${s.name} pieces`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div><button type="button" className="btn btn-sm btn-primary" disabled={!picked.length} onClick={add}><Plus /> Add to order</button></div>
        </div>
      )}
    </div>
  );
}

/** Admin: change quantities, remove items and add new articles to an order. */
export default function OrderItemsEditor({ order, items, paidVerified, onSaved, onCancel }) {
  const toast = useToast();
  const initial = useMemo(() => items.map((i) => ({ variant_id: i.variant_id, qty: Number(i.qty) || 0 })), [items]);
  const [lines, setLines] = useState(initial);
  // names for lines before / without a preview
  const [info, setInfo] = useState(() => Object.fromEntries(items.map((i) => [i.variant_id, i])));
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  // "less packing charges" can be ticked / unticked while editing too
  const [lessPacking, setLessPacking] = useState(order.less_packing === true);
  // "Update prices from products": today's product MRP for every item
  const [reprice, setReprice] = useState(false);
  const debounced = useDebounce(lines, 350);

  useEffect(() => {
    let live = true;
    const body = debounced.filter((l) => l.qty > 0);
    if (!body.length) { setPreview(null); return undefined; }
    setPreviewing(true);
    adminApi.post(`/orders/${encodeURIComponent(order.order_id)}/items/preview`, { items: body, less_packing: lessPacking, reprice })
      .then((res) => { if (live) setPreview(res); })
      .catch((err) => { if (live) toast.error(err.message); })
      .finally(() => { if (live) setPreviewing(false); });
    return () => { live = false; };
  }, [debounced, order.order_id, toast, tick, lessPacking, reprice]);

  const byVariant = useMemo(() => new Map((preview?.quote.lines || []).map((l) => [l.variant_id, l])), [preview]);
  const changed = !sameLines(lines, initial) || lessPacking !== (order.less_packing === true) || reprice;
  const stale = debounced !== lines || previewing;
  const quote = preview?.quote;
  const newTotal = preview?.new_final_payable ?? null;
  const diff = newTotal === null ? 0 : newTotal - (Number(paidVerified) || 0);

  const setQty = (variantId, qty) => setLines((prev) => prev.map((l) => (l.variant_id === variantId ? { ...l, qty } : l)));
  const remove = (variantId) => setLines((prev) => prev.filter((l) => l.variant_id !== variantId));
  const add = (added) => {
    setInfo((prev) => ({ ...prev, ...Object.fromEntries(added.map((a) => [a.variant_id, a])) }));
    setLines((prev) => {
      const next = prev.map((l) => ({ ...l }));
      for (const a of added) {
        const found = next.find((l) => l.variant_id === a.variant_id);
        if (found) found.qty += a.qty;
        else next.push({ variant_id: a.variant_id, qty: a.qty });
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminApi.put(`/orders/${encodeURIComponent(order.order_id)}/items`, {
        items: lines.filter((l) => l.qty > 0), client_final_payable: quote.final_payable, note, less_packing: lessPacking, reprice,
      });
      toast.success(`Order ${order.order_number} updated · new total ${formatINR(res.totals.final_payable)}`);
      onSaved(res);
    } catch (err) {
      toast.error(err.message);
      setTick((t) => t + 1); // stock / prices changed: show the fresh preview
    } finally {
      setSaving(false);
    }
  };

  const canSave = changed && lines.length > 0 && quote && !stale && !quote.has_issues && !saving;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {order.locked && (
        <Alert type="warning">
          This order is {paidVerified > 0 ? 'paid' : 'locked'}. Saving changes the items, stock and bill straight away
          {paidVerified > 0 ? ' - collect or refund the difference outside the website.' : '.'}
        </Alert>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Rate</th><th className="right">Line total</th><th /></tr></thead>
          <tbody>
            {lines.map((l) => {
              const p = byVariant.get(l.variant_id);
              const d = p || info[l.variant_id] || {};
              const units = Number(d.units_per_box) || 0;
              return (
                <tr key={l.variant_id}>
                  <td>
                    <div className="cell-main">{d.product_name || 'Item'}</div>
                    <div className="cell-sub">{[d.sku, describe(d)].filter(Boolean).join(' · ')}</div>
                    {p?.issue && <div className="small" style={{ color: 'var(--danger-700)' }}>{p.issue.message}</div>}
                  </td>
                  <td className="right">
                    <QuantitySelector size="sm" min={1} value={l.qty} onChange={(v) => setQty(l.variant_id, v)} label={`${d.product_name || 'Item'} quantity`} />
                    <div className="cell-sub">{units ? `${l.qty} ${l.qty === 1 ? 'box' : 'boxes'} · ${l.qty * units} pcs` : `${l.qty} pcs`}</div>
                  </td>
                  <td className="right num small">
                    {p?.unit_price != null ? <>{formatINR(p.unit_price)}<div className="cell-sub">{pct(p.discount_percent)} off</div></> : '—'}
                    {reprice && info[l.variant_id]?.mrp_unit != null && p?.unit_mrp != null && Number(info[l.variant_id].mrp_unit) !== Number(p.unit_mrp) && (
                      <div className="cell-sub" style={{ color: 'var(--warning-700)' }}>MRP {formatINR(info[l.variant_id].mrp_unit)} → {formatINR(p.unit_mrp)}</div>
                    )}
                  </td>
                  <td className="right num"><strong>{p?.line_total != null ? formatINR(p.line_total) : '—'}</strong></td>
                  <td className="right"><button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(l.variant_id)} aria-label={`Remove ${d.product_name || 'item'}`}><Trash2 /></button></td>
                </tr>
              );
            })}
            {!lines.length && <tr><td colSpan={5} className="small muted">No items left. Add an article, or cancel the order instead.</td></tr>}
          </tbody>
        </table>
      </div>

      <AddItems orderId={order.order_id} onAdd={add} />

      <label className={`packing-choice${reprice ? ' is-on' : ''}`}>
        <input type="checkbox" checked={reprice} onChange={(e) => setReprice(e.target.checked)} />
        <span>
          <strong>Update prices from products</strong>
          <span className="small">Every item takes the product&apos;s MRP of today (size-wise) - use it when a wrong MRP was corrected. Check the new rates, then save.</span>
        </span>
      </label>

      {quote?.packing_choice && (
        <label className={`packing-choice${lessPacking ? ' is-on' : ''}`}>
          <input type="checkbox" checked={lessPacking} onChange={(e) => setLessPacking(e.target.checked)} />
          <span>
            <strong>Less packing charges</strong>
            <span className="small">{lessPacking ? 'Taken off' : 'Tick to take'} <strong>{formatINR(quote.packing_charges)}</strong> {lessPacking ? 'from this order (customer does not want packing).' : 'off this order.'}</span>
            <span className="tiny soft">{(quote.packing_breakdown || []).map((b) => `${b.category_name}: ${b.pieces} pcs × ₹${b.rate}`).join(' · ')}</span>
          </span>
        </label>
      )}

      <div className="packing-box">
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="small">Current total <strong>{formatINR(order.final_payable)}</strong></div>
          <div className="small">New total {!lines.length ? '—' : stale || newTotal === null ? <Spinner small /> : <strong>{formatINR(newTotal)}</strong>}</div>
          {quote && <div className="small muted">{quote.total_pieces} pcs · discount {pct(quote.effective_discount_percent)}</div>}
          {preview?.packing_deduction > 0 && <div className="small muted">after packing charges {formatINR(preview.packing_deduction)}</div>}
        </div>
        {paidVerified > 0 && newTotal !== null && !stale && (
          <div className="small">
            Verified payment {formatINR(paidVerified)} · {diff > 0.009 ? <strong>still to pay {formatINR(diff)}</strong> : diff < -0.009 ? <strong>refund {formatINR(-diff)}</strong> : 'fully paid'}
          </div>
        )}
        {quote?.has_issues && <Alert type="error">Some items are not available in this quantity. Fix the items in red to save.</Alert>}
        {quote && !quote.has_issues && !quote.minimum_order_met && (
          <Alert type="info">Below the minimum order value ({formatINR(quote.minimum_order_value)}). You can still save it.</Alert>
        )}
      </div>

      <Field label="Note (optional, saved in the audit trail)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. customer asked on WhatsApp to add 2 boxes" />
      </Field>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={save}>{saving && <Spinner small />} Save changes</button>
        <button type="button" className="btn" disabled={saving} onClick={onCancel}>Cancel</button>
        {!changed && <span className="small muted">Change a quantity or add an article to save.</span>}
      </div>
    </div>
  );
}
