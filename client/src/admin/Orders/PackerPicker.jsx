import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, PackageCheck, Send } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Field, Spinner } from '../../components/common/ui.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { formatDateTime } from '../../utils/format.js';

/** Active packing team for the dropdowns. */
export function usePackers(enabled = true) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    adminApi.get('/packers?active=1').then((r) => alive && setItems(r.items)).catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [enabled]);
  return items;
}

/** "Who will pack?" + send the slip on WhatsApp (used in the Processing dialog). */
/**
 * Packer picker. `required` (Handed over): the packer must be chosen and no
 * slip is sent - the order is already packed.
 */
export function PackerFields({ value, onChange, required = false }) {
  const packers = usePackers();
  if (packers === null) return <Spinner small />;
  if (!packers.length) {
    return <Alert type="info">No packing team yet. Add the people who pack in <Link className="link" to="/admin/packers">Packing team</Link> - then pick one here and they get the packing slip on WhatsApp.</Alert>;
  }
  return (
    <div className="form-grid">
      <Field label={required ? 'Who packed this order? (required)' : 'Who will pack this order?'} hint={required ? 'Needed before the order is marked Handed over.' : 'They get the packing slip (no amounts) on WhatsApp.'}>
        <select className="select" value={value.packer_id} onChange={(e) => onChange({ ...value, packer_id: e.target.value })}>
          <option value="">{required ? 'Choose the packer…' : 'Decide later'}</option>
          {packers.map((p) => <option key={p.packer_id} value={p.packer_id}>{p.name}{p.packing_now ? ` (${p.packing_now} open)` : ''}</option>)}
        </select>
      </Field>
      {!required && (
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}>
          <input type="checkbox" checked={value.send} disabled={!value.packer_id} onChange={(e) => onChange({ ...value, send: e.target.checked })} /> Send packing slip on WhatsApp
        </label>
      )}
    </div>
  );
}

/** Assign + send; shows the result (and a "send from my WhatsApp" fallback). */
export async function sendToPacker(orderId, { packer_id: packerId, send }, toast) {
  const res = await adminApi.post(`/orders/${encodeURIComponent(orderId)}/packer`, { packer_id: packerId, send });
  if (!send) toast.success(`Packing by ${res.packer.name}.`);
  else if (res.sent) toast.success(`Packing slip sent to ${res.packer.name} on WhatsApp.`);
  else toast.error(res.error || 'WhatsApp not sent.');
  return res;
}

/** Order detail card: who packs, slip PDF, send again / change packer. */
export function PackingCard({ order, onChanged }) {
  const toast = useToast();
  const packers = usePackers();
  const [pick, setPick] = useState({ packer_id: order.packer_id || '', send: true });
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(null);
  useEffect(() => { setPick({ packer_id: order.packer_id || '', send: true }); }, [order.packer_id]);

  const go = async () => {
    setBusy(true);
    setFallback(null);
    try {
      const res = await sendToPacker(order.order_id, pick, toast);
      if (pick.send && !res.sent) setFallback(res.wa_link);
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad">
      <h3 className="card-title"><PackageCheck /> Packing</h3>
      {order.packer_name ? (
        <p className="small mb-1">
          Packing by <strong>{order.packer_name}</strong>
          {order.packing_slip_sent_at ? ` · slip sent ${formatDateTime(order.packing_slip_sent_at)}` : ' · slip not sent yet'}
        </p>
      ) : <p className="small muted mb-1">No packer chosen yet.</p>}
      <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
        <select className="select" style={{ maxWidth: 220 }} value={pick.packer_id} onChange={(e) => setPick({ ...pick, packer_id: e.target.value })} aria-label="Packer">
          <option value="">Choose packer…</option>
          {(packers || []).map((p) => <option key={p.packer_id} value={p.packer_id}>{p.name}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-primary" onClick={go} disabled={busy || !pick.packer_id}>
          {busy ? <Spinner small /> : <Send />} {order.packer_id === pick.packer_id && order.packing_slip_sent_at ? 'Send again' : 'Send slip on WhatsApp'}
        </button>
        <a className="btn btn-sm" href={`/api/admin/orders/${encodeURIComponent(order.order_id)}/packing-slip`} download><FileDown /> Packing slip PDF</a>
      </div>
      {fallback && (
        <Alert type="warning" className="mt-2">
          WhatsApp could not be sent automatically. <a className="link" href={fallback} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Send from my WhatsApp</a>
        </Alert>
      )}
      <p className="tiny soft mt-1 mb-0">The packing slip has articles, colours, sizes, quantities and the address - no rates or amounts.</p>
    </section>
  );
}
