import { useEffect, useState } from 'react';
import { ArrowRight, Replace } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import {
  Alert, Field, PageLoader, Spinner,
} from '../../components/common/ui.jsx';

const Dot = ({ hex }) => <i className="swatch-dot swatch-dot-sm" style={{ background: hex || '#ddd' }} />;

/**
 * Replace one colour of an article with another, stock included
 * (e.g. Sahin Set: Lavender -> Pink). Shows size by size what happens first.
 */
export function ColourReplaceDialog({ productId, open, onClose, onDone, note }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !productId) return undefined;
    let alive = true;
    setData(null); setFrom(''); setTo(''); setPreview(null); setError(null);
    Promise.all([adminApi.get(`/products/${productId}`), adminApi.get('/colors')])
      .then(([p, c]) => { if (alive) setData({ product: p.product, colours: c.items }); })
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [open, productId]);

  useEffect(() => {
    setPreview(null);
    if (!from || !to) return undefined;
    let alive = true;
    adminApi.get(`/products/${productId}/replace-colour${qs({ from, to })}`)
      .then((r) => { if (alive) { setPreview(r); setError(null); } })
      .catch((err) => alive && setError(err));
    return () => { alive = false; };
  }, [from, to, productId]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await adminApi.post(`/products/${productId}/replace-colour`, { from_color_id: from, to_color_id: to });
      toast.success(`${r.from.color_name} replaced with ${r.to.color_name} in ${r.product_name} - ${r.pieces_moved} pcs moved.`);
      onDone?.(r);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const ids = data ? [].concat(data.product.color_ids || []) : [];
  const own = data ? data.colours.filter((c) => ids.includes(c.color_id)) : [];
  const choices = data ? data.colours.filter((c) => c.status === 'ACTIVE' && c.color_id !== from) : [];
  return (
    <Modal
      open={open}
      size="lg"
      title={data ? `Replace colour · ${data.product.product_name}` : 'Replace colour'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !preview}>
            {busy ? <Spinner small /> : <Replace />} Replace{preview ? ` ${preview.from.color_name} with ${preview.to.color_name}` : ''}
          </button>
        </>
      )}
    >
      {!data && !error ? <PageLoader /> : (
        <div className="stack">
          <p className="small muted mb-0">Only this article changes. The stock moves to the new colour; old orders and bills keep the colour name they were placed with.</p>
          {note && <Alert type="warning">{note}</Alert>}
          {data && (
            <div className="form-grid">
              <Field label="Colour to replace">
                <select className="select" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value === to) setTo(''); }}>
                  <option value="">Choose…</option>
                  {own.map((c) => <option key={c.color_id} value={c.color_id}>{c.color_name}</option>)}
                </select>
              </Field>
              <Field label="New colour" hint="Any colour from Colours. Missing? Add it in Admin → Colors first.">
                <select className="select" value={to} onChange={(e) => setTo(e.target.value)} disabled={!from}>
                  <option value="">Choose…</option>
                  {choices.map((c) => <option key={c.color_id} value={c.color_id}>{c.color_name}{ids.includes(c.color_id) ? ' (already in this article)' : ''}</option>)}
                </select>
              </Field>
            </div>
          )}
          {error && <Alert type="error">{error.message}</Alert>}
          {preview && (
            <>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge badge-outline"><Dot hex={preview.from.hex_code} /> {preview.from.color_name}</span>
                <ArrowRight size={16} />
                <span className="badge badge-gold"><Dot hex={preview.to.hex_code} /> {preview.to.color_name}</span>
                <span className="small muted">{preview.new_colour_already_there ? `${preview.to.color_name} is already in this article: the pieces are added to it.` : `${preview.from.color_name} becomes ${preview.to.color_name} with all its pieces.`}</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Size</th><th className="right">{preview.from.color_name} stock</th><th>What happens</th><th className="right">{preview.to.color_name} after</th></tr></thead>
                  <tbody>
                    {preview.sizes.map((s) => (
                      <tr key={s.variant_id}>
                        <td>{s.size_name || '—'}{!s.active && <span className="soft small"> (off)</span>}</td>
                        <td className="right num">{s.stock}{s.reserved > 0 && <div className="cell-sub">{s.reserved} in pending orders</div>}</td>
                        <td className="small">
                          {s.action === 'rename' ? `Becomes ${preview.to.color_name}` : `${s.move} pcs move to ${preview.to.color_name}`}
                          {s.action === 'merge' && s.reserved > 0 && <div className="cell-sub">{s.reserved} pcs stay for their pending orders</div>}
                        </td>
                        <td className="right num"><strong>{s.new_stock}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.pieces_held > 0 && <Alert type="info">{preview.pieces_held} pcs are held by pending orders and stay on {preview.from.color_name} until those orders are done. If such an order is cancelled, replace the colour again to move them too.</Alert>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
