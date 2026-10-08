import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, Boxes, Copy, PackageCheck, PackageX, Pencil, Plus, Power, Shirt,
} from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, SearchBox, ConfirmDialog } from '../components.jsx';
import {
  Alert, EmptyState, ErrorState, Field, Img, PageLoader, Spinner, StatusBadge,
} from '../../components/common/ui.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { qs } from '../../services/api.js';

function SellBadge({ p }) {
  const box = p.units_per_box || (p.sell_mode && p.sell_mode !== 'PCS' ? '?' : null);
  return (
    <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
      <span className={`badge ${box ? 'badge-gold' : 'badge-outline'}`}>{box ? `Box of ${box} pcs` : 'No box'}</span>
      <span className="cell-sub">{p.pcs_for_new_customers ? 'Pcs: everyone' : 'Pcs: existing only'}</span>
    </div>
  );
}

// Bulk "Box / pieces": many products at once (e.g. a whole category).
function BulkSellingDialog({ open, products, onClose, onDone }) {
  const toast = useToast();
  const [withBox, setWithBox] = useState(true);
  const [units, setUnits] = useState('');
  const [pcsNew, setPcsNew] = useState('keep');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const apply = async () => {
    if (withBox && !(Number(units) >= 1)) { toast.error('Enter how many pieces are in one box.'); return; }
    setBusy(true);
    try {
      const res = await adminApi.post('/products/bulk-selling', {
        product_ids: products.map((p) => p.product_id),
        units_per_box: withBox ? Number(units) : null,
        ...(pcsNew === 'keep' ? {} : { pcs_for_new_customers: pcsNew === 'yes' }),
      });
      setResult(res);
      toast.success(`Box / pieces saved for ${res.updated.length} product(s).`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { setResult(null); onClose(); };
  return (
    <Modal
      open={open}
      title={result ? 'Box / pieces saved' : `Box / pieces · ${products.length} product(s)`}
      onClose={close}
      footer={result ? <button type="button" className="btn btn-primary" onClick={close}>Done</button> : (
        <>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>{busy && <Spinner small />} Apply to {products.length} product(s)</button>
        </>
      )}
    >
      {result ? (
        <div className="stack">
          <Alert type="success">Updated {result.updated.length} · already set {result.unchanged.length} · skipped {result.skipped.length}</Alert>
          {result.skipped.length > 0 && <Alert type="warning">{result.skipped.map((x) => x.reason).join(' · ')}</Alert>}
        </div>
      ) : (
        <div className="stack">
          <p className="small muted mb-0">Existing customers can always choose a full box or loose pieces. New customers buy full boxes - unless you allow loose pieces below.</p>
          <div className="choice-grid">
            <button type="button" className="choice" aria-pressed={withBox} onClick={() => setWithBox(true)}><Boxes /><span><strong>Box</strong><span className="small muted">One box per size, assorted colours.</span></span></button>
            <button type="button" className="choice" aria-pressed={!withBox} onClick={() => setWithBox(false)}><span><strong>No box</strong><span className="small muted">Loose pieces only.</span></span></button>
          </div>
          {withBox && (
            <div className="form-grid">
              <Field label="Pieces in one box" required hint="Box price = pieces × piece MRP of that size. Boxes are packed from the loose pieces - no box stock to enter.">
                <input className="input" type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value.replace(/[^\d]/g, ''))} />
              </Field>
            </div>
          )}
          <Field label="Loose pieces for NEW customers">
            <select className="select" value={pcsNew} onChange={(e) => setPcsNew(e.target.value)}>
              <option value="keep">Keep each product as it is</option>
              <option value="no">Not allowed - new customers buy boxes</option>
              <option value="yes">Allowed (e.g. stock cannot make a full box)</option>
            </select>
          </Field>
          <p className="tiny soft mb-0">Prices, piece stock, images and everything else stay unchanged. Old variants are kept inactive (never deleted), so you can switch back any time.</p>
        </div>
      )}
    </Modal>
  );
}

export default function ProductList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [mode, setMode] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const toast = useToast();
  const navigate = useNavigate();
  const cats = useAsync(() => adminApi.get('/categories'), []);
  const { data, loading, error, reload } = useAsync(
    () => adminApi.get(`/products${qs({ q: dq, status, category_id: category })}`),
    [dq, status, category],
  );

  const items = useMemo(() => (data?.items || []).filter((p) => {
    const box = Number(p.units_per_box) > 0 || (p.sell_mode && p.sell_mode !== 'PCS');
    if (mode === 'box') return box;
    if (mode === 'nobox') return !box;
    if (mode === 'pcsnew') return p.pcs_for_new_customers;
    return true;
  }), [data, mode]);
  const counts = useMemo(() => ({ all: items.length, active: items.filter((p) => p.status === 'ACTIVE').length }), [items]);

  const act = async (fn, msg) => {
    try {
      const res = await fn();
      toast.success(msg);
      reload();
      return res;
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const duplicate = async (p) => {
    const res = await act(() => adminApi.post(`/products/${p.product_id}/duplicate`), `Duplicated ${p.product_name} (saved as inactive).`);
    if (res?.product) navigate(`/admin/products/${res.product.product_id}`);
  };

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Products are never deleted - deactivate or archive them to hide from the store."
        actions={<><Link to="/admin/catalog-import" className="btn">Import Nutex catalogue</Link><Link to="/admin/products/new" className="btn btn-primary"><Plus /> Add product</Link></>}
      />
      <div className="filter-bar">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, SKU or ID" />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option>
        </select>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats.data?.items || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
        </select>
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Box / pieces">
          <option value="">All (box / pieces)</option><option value="box">With box</option><option value="nobox">No box yet</option><option value="pcsnew">Pieces open for new customers</option>
        </select>
      </div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !items.length ? (
        <EmptyState icon={Shirt} title="No products found" action={<Link to="/admin/products/new" className="btn btn-primary">Add your first product</Link>} />
      ) : (
        <>
          <div className="row-between wrap mb-1">
            <p className="small muted mb-0">{counts.all} products · {counts.active} active{picked.size ? ` · ${picked.size} selected` : ''}</p>
            <div className="row wrap">
              <button type="button" className="btn btn-sm" onClick={() => setPicked(picked.size === items.length ? new Set() : new Set(items.map((p) => p.product_id)))}>{picked.size === items.length ? 'Clear selection' : `Select all ${items.length}`}</button>
              <button type="button" className="btn btn-sm btn-primary" disabled={!picked.size} onClick={() => setBulkOpen(true)}><Boxes /> Box / pieces</button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th aria-label="Select" /><th>Product</th><th>Category</th><th className="right">MRP</th><th className="right">Wholesale*</th><th>Selling</th><th className="right">Available</th><th>Status</th><th className="right">Actions</th></tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.product_id}>
                    <td><input type="checkbox" checked={picked.has(p.product_id)} aria-label={`Select ${p.product_name}`} onChange={() => setPicked((cur) => { const next = new Set(cur); if (next.has(p.product_id)) next.delete(p.product_id); else next.add(p.product_id); return next; })} /></td>
                    <td>
                      <div className="row">
                        <div className="thumb"><Img src={p.image ? p.image.replace('/media/', '/api/admin/media/') : ''} label={p.product_name} alt="" /></div>
                        <div><Link to={`/admin/products/${p.product_id}`} className="cell-main">{p.product_name}</Link><div className="cell-sub">{p.sku}{p.featured ? ' · Featured' : ''}</div></div>
                      </div>
                    </td>
                    <td className="small">{p.category_name}</td>
                    <td className="right num">{formatINR(p.mrp)}</td>
                    <td className="right num">{formatINR(p.price_preview.unit_price)}<div className="cell-sub">{pct(p.price_preview.discount_percent)}{p.discount_mode === 'CUSTOM' ? ' (product)' : ''}</div></td>
                    <td><SellBadge p={p} /></td>
                    <td className="right num">{p.total_available}<div className="cell-sub">{p.oos_variants ? `${p.oos_variants}/${p.variant_count} variants OOS` : `${p.variant_count} variants`}</div></td>
                    <td>
                      <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                        <StatusBadge kind="record" status={p.status} />
                        {p.out_of_stock && <StatusBadge kind="record" status="OUT_OF_STOCK" />}
                      </div>
                    </td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Link to={`/admin/products/${p.product_id}`} className="btn btn-sm btn-icon" title="Edit"><Pencil /></Link>
                        <button type="button" className="btn btn-sm btn-icon" title="Duplicate" onClick={() => duplicate(p)}><Copy /></button>
                        <button
                          type="button"
                          className="btn btn-sm btn-icon"
                          title={p.out_of_stock ? 'Restore stock' : 'Mark out of stock'}
                          onClick={() => act(() => adminApi.post(`/products/${p.product_id}/out-of-stock`, { out_of_stock: !p.out_of_stock }), p.out_of_stock ? 'Stock restored.' : 'Marked out of stock.')}
                        >
                          {p.out_of_stock ? <PackageCheck /> : <PackageX />}
                        </button>
                        {p.status === 'ACTIVE' ? (
                          <button type="button" className="btn btn-sm btn-icon" title="Deactivate" onClick={() => setConfirm({ p, action: 'deactivate' })}><Power /></button>
                        ) : (
                          <button type="button" className="btn btn-sm btn-icon" title="Reactivate" onClick={() => act(() => adminApi.post(`/products/${p.product_id}/reactivate`), 'Product reactivated.')}><Power color="var(--success-500)" /></button>
                        )}
                        {p.status !== 'ARCHIVED' && <button type="button" className="btn btn-sm btn-icon" title="Archive" onClick={() => setConfirm({ p, action: 'archive' })}><Archive /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny soft mt-1">* Indicative price under the current discount settings (slab mode shows the entry slab). Old orders keep their own saved prices.</p>
        </>
      )}
      <BulkSellingDialog
        open={bulkOpen}
        products={(data?.items || []).filter((p) => picked.has(p.product_id))}
        onClose={() => setBulkOpen(false)}
        onDone={() => { setPicked(new Set()); reload(); }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === 'archive' ? 'Archive product?' : 'Deactivate product?'}
        message={`${confirm?.p.product_name} will be hidden from the store. Existing orders are not affected and you can reactivate it any time.`}
        confirmLabel={confirm?.action === 'archive' ? 'Archive' : 'Deactivate'}
        danger
        onClose={() => setConfirm(null)}
        onConfirm={() => act(() => adminApi.post(`/products/${confirm.p.product_id}/${confirm.action}`), confirm.action === 'archive' ? 'Product archived.' : 'Product deactivated.')}
      />
    </>
  );
}
