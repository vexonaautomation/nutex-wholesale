import { useMemo, useState } from 'react';
import { Boxes, RotateCcw, Save } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, SearchBox } from '../components.jsx';
import {
  Alert, EmptyState, ErrorState, Img, PageLoader, Spinner, StatusBadge,
} from '../../components/common/ui.jsx';
import { qs } from '../../services/api.js';

const digits = (v) => String(v ?? '').replace(/[^\d]/g, '');
const unitsOf = (v) => (Number(v) >= 1 ? Number(v) : null);
const currentOf = (p) => (p.units_per_box ? String(p.units_per_box) : '');

// how one box is packed from the loose colours of a size
function splitText(units, colours) {
  if (!units) return 'No box - loose pieces only';
  if (!colours) return 'Add colours first - boxes are packed from the loose pieces';
  const per = Math.floor(units / colours);
  const extra = units % colours;
  if (!per) return `${units} different colours, 1 each`;
  return extra ? `${per} of each colour + ${extra} extra` : `${per} of each colour`;
}

/**
 * "Pack of": how many pieces are in one box of each article. Type a number
 * per article (blank = no box) and save all changes at once, or tick articles
 * and set one number for all of them.
 */
export default function PackSizes() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [show, setShow] = useState('');
  const dq = useDebounce(q, 250);
  const cats = useAsync(() => adminApi.get('/categories'), []);
  const { data, loading, error, reload } = useAsync(
    () => adminApi.get(`/products${qs({ q: dq, category_id: category })}`),
    [dq, category],
  );
  // product_id -> { value, original, label } (kept while searching / filtering)
  const [edits, setEdits] = useState({});
  const [picked, setPicked] = useState(() => new Set());
  const [forTicked, setForTicked] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const rows = useMemo(() => (data?.items || []).filter((p) => {
    if (show === 'box') return Number(p.units_per_box) > 0;
    if (show === 'nobox') return !(Number(p.units_per_box) > 0);
    return true;
  }), [data, show]);
  const changes = Object.entries(edits).filter(([, e]) => e.value !== e.original);
  const valueOf = (p) => edits[p.product_id]?.value ?? currentOf(p);

  const setValue = (p, value) => setEdits((prev) => ({
    ...prev, [p.product_id]: { value, original: currentOf(p), label: `${p.sku} ${p.product_name}` },
  }));
  const applyToTicked = (value) => {
    const list = rows.filter((p) => picked.has(p.product_id));
    setEdits((prev) => {
      const next = { ...prev };
      for (const p of list) next[p.product_id] = { value, original: currentOf(p), label: `${p.sku} ${p.product_name}` };
      return next;
    });
  };
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allPicked = rows.length > 0 && rows.every((p) => picked.has(p.product_id));

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminApi.post('/products/pack-sizes', {
        items: changes.map(([id, e]) => ({ product_id: id, units_per_box: unitsOf(e.value) })),
      });
      setResult(res);
      setEdits({});
      toast.success(`Pack of saved for ${res.updated.length} article(s).`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader
        title="Pack of - pieces in one box"
        subtitle="How many pieces are in one box of each article. Change the numbers and press Save (blank = no box), or tick articles and set one number for all. Box price = pieces × piece MRP; boxes are packed from the loose pieces."
      />
      {result && (
        <Alert type={result.skipped.length ? 'warning' : 'success'} className="mb-2">
          Saved {result.updated.length} · already set {result.unchanged.length}{result.skipped.length ? ` · not changed ${result.skipped.length}: ${result.skipped.map((x) => x.reason).join(' · ')}` : ''}
        </Alert>
      )}

      <div className="filter-bar">
        <SearchBox value={q} onChange={setQ} placeholder="Search SKU or article name" />
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {(cats.data?.items || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
        </select>
        <select className="select" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
          <option value="">With and without box</option>
          <option value="box">With box</option>
          <option value="nobox">No box</option>
        </select>
      </div>

      {picked.size > 0 && (
        <div className="pack-bulk">
          <strong>{picked.size} ticked</strong>
          <span className="small">Box of</span>
          <input className="input pack-input" inputMode="numeric" placeholder="pcs" value={forTicked} onChange={(e) => setForTicked(digits(e.target.value))} aria-label="Pieces in one box for the ticked articles" />
          <span className="small">pcs</span>
          <button type="button" className="btn btn-sm btn-primary" disabled={!unitsOf(forTicked)} onClick={() => applyToTicked(forTicked)}><Boxes /> Set for ticked</button>
          <button type="button" className="btn btn-sm" onClick={() => applyToTicked('')}>No box</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicked(new Set())}>Clear ticks</button>
        </div>
      )}

      {!rows.length ? <EmptyState title="No articles found" /> : (
        <div className="card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((p) => p.product_id)))} aria-label="Tick all" /></th>
                  <th>Article</th>
                  <th>Category</th>
                  <th className="right">Sizes · colours</th>
                  <th>Box of (pcs)</th>
                  <th>Each box</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const value = valueOf(p);
                  const dirty = value !== currentOf(p);
                  return (
                    <tr key={p.product_id} className={dirty ? 'pack-dirty' : ''}>
                      <td><input type="checkbox" checked={picked.has(p.product_id)} onChange={() => toggle(p.product_id)} aria-label={`Tick ${p.sku}`} /></td>
                      <td>
                        <div className="row">
                          <div className="thumb"><Img src={p.image} alt="" label={p.product_name} /></div>
                          <div><div className="cell-main">{p.product_name}</div><div className="cell-sub">SKU {p.sku}</div></div>
                        </div>
                      </td>
                      <td className="small">{p.category_name}</td>
                      <td className="right small num">{p.size_count} · {p.colour_count}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <input
                            className="input pack-input"
                            inputMode="numeric"
                            placeholder="No box"
                            value={value}
                            onChange={(e) => setValue(p, digits(e.target.value))}
                            aria-label={`Pieces in one box of ${p.sku}`}
                          />
                          {dirty && <span className="cell-sub">was {currentOf(p) || 'no box'}</span>}
                        </div>
                      </td>
                      <td className="small">{splitText(unitsOf(value), p.colour_count)}</td>
                      <td><StatusBadge status={p.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {changes.length > 0 && (
        <div className="pack-savebar">
          <span><strong>{changes.length}</strong> article(s) changed</span>
          <button type="button" className="btn btn-ghost" onClick={() => setEdits({})} disabled={saving}><RotateCcw /> Undo</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <Spinner small /> : <Save />} Save {changes.length} change(s)</button>
        </div>
      )}
    </>
  );
}
