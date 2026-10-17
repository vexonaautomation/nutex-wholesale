import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Spinner } from '../../components/common/ui.jsx';

// Nutex size-wise MRP rule for the ticked articles: shows what changes first.
const RULES = [
  ['Bras', '28-40 = MRP · 42-44 = MRP + ₹6'],
  ['Sets', 'same MRP for every size (no increase)'],
  ['Panties', '32-38 = MRP · 40 = + ₹12 · 42-44 = + ₹24 · 46 = + ₹36'],
  ['Gents vests', 'S-L = MRP · XL-XXL = + ₹16'],
  ['Gents underwear', 'S-L = MRP · XL-2XL = + ₹20 · 3XL-4XL = + ₹40'],
];

export function SizeMrpRuleDialog({ open, productIds, onClose, onDone }) {
  const toast = useToast();
  const [force, setForce] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const idsKey = productIds.join(',');

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setPreview(null);
    setError(null);
    adminApi.post('/products/size-mrp-rules', { product_ids: idsKey.split(','), force, dry_run: true })
      .then((r) => alive && setPreview(r))
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [open, force, idsKey]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await adminApi.post('/products/size-mrp-rules', { product_ids: productIds, force });
      toast.success(`Size-wise MRP set for ${r.updated.length} article(s).`);
      onDone?.();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      size="lg"
      title={`Size-wise MRP rule · ${productIds.length} article(s)`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !preview?.updated.length}>
            {busy ? <Spinner small /> : <CheckCircle2 />} Apply to {preview?.updated.length ?? 0} article(s)
          </button>
        </>
      )}
    >
      <div className="stack">
        <div className="table-wrap">
          <table className="table">
            <tbody>{RULES.map(([k, v]) => <tr key={k}><td className="cell-main">{k}</td><td className="small">{v}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="small muted mb-0">The article MRP is the price of the smaller sizes. Sizes not named keep their price; box prices follow automatically.</p>
        <label className="check"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Also change articles that already have their own size-wise MRP</label>
        {error && <Alert type="error">{error.message}</Alert>}
        {!preview && !error && <Spinner />}
        {preview && (
          <>
            {preview.updated.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 280 }}>
                <table className="table">
                  <thead><tr><th>Article</th><th>Rule</th><th>New size MRPs</th></tr></thead>
                  <tbody>
                    {preview.updated.map((u) => (
                      <tr key={u.sku}><td><div className="cell-main">{u.name}</div><div className="cell-sub">{u.sku}</div></td><td className="small">{u.rule}</td><td className="small">{u.sizes.join(' · ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.unchanged.length > 0 && <p className="small muted mb-0">Already right: {preview.unchanged.length} article(s).</p>}
            {preview.skipped.length > 0 && <Alert type="info">Not changed: {preview.skipped.map((s) => s.reason).join(' · ')}</Alert>}
          </>
        )}
      </div>
    </Modal>
  );
}
