import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, RotateCcw } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../components.jsx';
import { Alert, EmptyState, ErrorState, PageLoader, Spinner } from '../../components/common/ui.jsx';

export default function Inventory() {
  const toast = useToast();
  const [productId, setProductId] = useState('');
  const [filter, setFilter] = useState('');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  const products = useAsync(() => adminApi.get('/products'), []);
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/inventory${qs({ product_id: productId, filter })}`), [productId, filter]);

  // only variants currently sold (a box-only product hides its old piece variants and vice versa)
  const items = useMemo(() => (data?.items || []).filter((i) => i.offered ?? i.variant_status === 'ACTIVE'), [data]);
  const pcsItems = useMemo(() => items.filter((i) => i.inventory_mode !== 'BOX_WISE'), [items]);
  const boxItems = useMemo(() => items.filter((i) => i.inventory_mode === 'BOX_WISE'), [items]);
  const product = (products.data?.items || []).find((p) => p.product_id === productId);
  const dirty = Object.keys(edits).length;

  const valueOf = (row, key) => (edits[row.inventory_id]?.[key] ?? row[key]);
  const edit = (row, key, value) => {
    setEdits((e) => {
      const next = { ...e, [row.inventory_id]: { ...e[row.inventory_id], [key]: value } };
      const cur = next[row.inventory_id];
      if ((cur.stock_qty === undefined || cur.stock_qty === row.stock_qty) && (cur.status === undefined || cur.status === row.status)) delete next[row.inventory_id];
      return next;
    });
  };

  const save = async () => {
    const byId = new Map((data?.items || []).map((r) => [r.inventory_id, r]));
    const updates = Object.entries(edits).map(([id, e]) => ({
      inventory_id: id,
      ...(e.stock_qty !== undefined ? { stock_qty: e.stock_qty, expected_stock_qty: byId.get(id)?.stock_qty } : {}),
      ...(e.status ? { status: e.status } : {}),
    }));
    setSaving(true);
    setConflict(null);
    try {
      const r = await adminApi.put('/inventory', { updates });
      toast.success(`${r.updated} inventory row(s) updated. Unrelated variants were not touched.`);
      setEdits({});
      reload();
    } catch (err) {
      if (err.code === 'STOCK_CONFLICT') setConflict(err);
      else toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const showMatrix = Boolean(product) && pcsItems.length > 0 && !filter;
  const matrix = useMemo(() => {
    if (!showMatrix) return null;
    const colors = [...new Map(pcsItems.map((i) => [i.color_id, { id: i.color_id, name: i.color_name, hex: i.hex_code }])).values()];
    const sizes = [...new Map(pcsItems.map((i) => [i.size_id, { id: i.size_id, name: i.size_name }])).values()];
    const cell = new Map(pcsItems.map((i) => [`${i.color_id}|${i.size_id}`, i]));
    return { colors, sizes, cell };
  }, [showMatrix, pcsItems]);

  const stockInput = (row) => {
    const v = valueOf(row, 'stock_qty');
    return (
      <input
        type="number"
        min={row.reserved_qty}
        value={v}
        className={`${v === 0 ? 'is-zero' : ''} ${edits[row.inventory_id]?.stock_qty !== undefined ? 'is-dirty' : ''}`}
        onChange={(e) => edit(row, 'stock_qty', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        aria-label={`Stock for ${row.sku}`}
      />
    );
  };

  const renderTable = (rows) => (
    <div className="table-wrap">
      <table className="table matrix" style={{ width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Product</th><th style={{ textAlign: 'left' }}>Variant</th><th style={{ textAlign: 'left' }}>SKU</th><th>Stock</th><th>Reserved</th><th>Available</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.inventory_id}>
              <td style={{ textAlign: 'left' }}><div className="cell-main">{r.product_name}</div><div className="cell-sub">{r.product_sku}</div></td>
              <td style={{ textAlign: 'left' }} className="small">
                {r.inventory_mode === 'BOX_WISE'
                  ? <>Box of {r.units_per_box} pcs{r.size_name ? ` · Size ${r.size_name}` : ''}<div className="cell-sub">{r.mixed_color_description || 'Mixed colours'}</div></>
                  : <span className="row"><i className="swatch-dot swatch-dot-sm" style={{ background: r.hex_code || '#ddd' }} />{r.color_name} · {r.size_name}</span>}
              </td>
              <td style={{ textAlign: 'left' }} className="small">{r.sku}</td>
              <td>{stockInput(r)}</td>
              <td className="num">{r.reserved_qty}</td>
              <td className="num">
                <span className={`badge ${r.out_of_stock ? 'badge-danger' : r.low_stock ? 'badge-warning' : 'badge-success'}`}>{Math.max(0, valueOf(r, 'stock_qty') - r.reserved_qty)}</span>
              </td>
              <td>
                <select className="select" style={{ minHeight: 32, fontSize: 13, width: 140 }} value={valueOf(r, 'status')} onChange={(e) => edit(r, 'status', e.target.value)}>
                  <option value="ACTIVE">In stock</option><option value="OUT_OF_STOCK">Out of stock</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle={`Stock = physical units. Reserved = held by unpaid orders. Available = stock − reserved. Low stock at ≤ ${data?.threshold ?? '…'}.`}
        actions={(
          <>
            {dirty > 0 && <button type="button" className="btn" onClick={() => setEdits({})}><RotateCcw /> Discard</button>}
            <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? <Spinner small /> : <Save />} Save changes{dirty ? ` (${dirty})` : ''}</button>
          </>
        )}
      />
      <div className="filter-bar">
        <select className="select" value={productId} onChange={(e) => { setProductId(e.target.value); setEdits({}); }} aria-label="Product" style={{ minWidth: 260 }}>
          <option value="">All products</option>
          {(products.data?.items || []).map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name} ({p.sku})</option>)}
        </select>
        <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          <option value="">All variants</option><option value="low">Low stock</option><option value="out">Out of stock</option>
        </select>
        {product && <Link to={`/admin/products/${product.product_id}`} className="btn btn-sm">Edit product</Link>}
      </div>
      {conflict && <Alert type="error" className="mb-2">{conflict.message} <button type="button" className="link" onClick={() => { setEdits({}); setConflict(null); reload(); }}>Reload stock</button></Alert>}
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !items.length ? (
        <EmptyState title="No inventory rows">Inventory rows are created automatically when you publish a product.</EmptyState>
      ) : matrix ? (
        <>
        <h4 className="mb-1">Loose pieces</h4>
        <div className="matrix-wrap">
          <table className="matrix">
            <thead><tr><th className="row-head">{product.product_name}</th>{matrix.sizes.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
            <tbody>
              {matrix.colors.map((c) => (
                <tr key={c.id}>
                  <th className="row-head"><span className="row"><i className="swatch-dot swatch-dot-sm" style={{ background: c.hex || '#ddd' }} />{c.name.toUpperCase()}</span></th>
                  {matrix.sizes.map((s) => {
                    const row = matrix.cell.get(`${c.id}|${s.id}`);
                    if (!row) return <td key={s.id} className="na">—</td>;
                    return (
                      <td key={s.id}>
                        {stockInput(row)}
                        <span className="cell-meta">{row.reserved_qty ? `${row.reserved_qty} res · ` : ''}{Math.max(0, valueOf(row, 'stock_qty') - row.reserved_qty)} avail</span>
                        <label className="cell-meta" style={{ cursor: 'pointer' }}>
                          <input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={valueOf(row, 'status') === 'OUT_OF_STOCK'} onChange={(e) => edit(row, 'status', e.target.checked ? 'OUT_OF_STOCK' : 'ACTIVE')} /> OOS
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {boxItems.length > 0 && <><h4 className="mb-1 mt-3">Boxes (number of boxes per size)</h4>{renderTable(boxItems)}</>}
        </>
      ) : renderTable(items)}
    </>
  );
}
