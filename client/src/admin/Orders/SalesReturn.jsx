import { useState } from 'react';
import { Ban, FileDown, Undo2 } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { ConfirmDialog } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Field, Spinner } from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';

export function ReturnStatus({ status }) {
  return status === 'CANCELLED'
    ? <span className="badge badge-outline">Cancelled</span>
    : <span className="badge badge-success">Active</span>;
}

export const creditNoteUrl = (r) => `/api/admin/sales-returns/${encodeURIComponent(r.return_id)}/pdf`;

export function CancelReturnDialog({ item, onClose, onDone }) {
  const toast = useToast();
  return (
    <ConfirmDialog
      open={!!item}
      title={`Cancel sales return ${item?.return_number || ''}?`}
      message="Use this only for a return entered by mistake. Good pieces go out of stock again, and the items can be returned again."
      confirmLabel="Cancel return"
      danger
      reasonLabel="Reason"
      reasonRequired
      onClose={onClose}
      onConfirm={async (reason) => {
        await adminApi.post(`/sales-returns/${encodeURIComponent(item.return_id)}/cancel`, { reason });
        toast.success(`Sales return ${item.return_number} cancelled.`);
        onDone();
      }}
    />
  );
}

const units = (i, n) => `${n} ${i.sold_in === 'Box' ? (n === 1 ? 'box' : 'boxes') : 'pcs'}`;

function NewReturn({ data, orderId, onClose, onSaved }) {
  const toast = useToast();
  const [qty, setQty] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const value = (id, kind) => Number(qty[id]?.[kind]) || 0;
  const set = (id, kind) => (e) => setQty((q) => ({ ...q, [id]: { ...q[id], [kind]: e.target.value.replace(/\D/g, '') } }));
  const open = data.items.filter((i) => i.returnable > 0);
  const over = open.filter((i) => value(i.order_item_id, 'good') + value(i.order_item_id, 'damaged') > i.returnable);
  const subtotal = open.reduce((s, i) => s + (value(i.order_item_id, 'good') + value(i.order_item_id, 'damaged')) * i.unit_amount, 0);
  const credit = subtotal * (1 - data.packing_share);

  const save = async () => {
    const items = open.flatMap((i) => [
      { order_item_id: i.order_item_id, qty: value(i.order_item_id, 'good'), condition: 'GOOD' },
      { order_item_id: i.order_item_id, qty: value(i.order_item_id, 'damaged'), condition: 'DAMAGED' },
    ]).filter((l) => l.qty > 0);
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.post(`/orders/${encodeURIComponent(orderId)}/returns`, { items, reason });
      toast.success(`Sales return ${res.sales_return.return_number} saved.`);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title="New sales return"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={busy || subtotal <= 0 || over.length > 0 || reason.trim().length < 3} onClick={save}>{busy && <Spinner small />} Save return</button>
        </>
      )}
    >
      <div className="stack">
        {error && <Alert type="error">{error.message}</Alert>}
        <p className="small muted mb-0">Good pieces go back into stock. Damaged pieces are only recorded. Box items are returned in whole boxes.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th className="right">Good</th><th className="right">Damaged</th></tr></thead>
            <tbody>
              {open.map((i) => (
                <tr key={i.order_item_id}>
                  <td className="cell-main">{i.product_name}<div className="cell-sub">{[i.colour, i.size].filter(Boolean).join(' · ')}{i.pcs_per_box ? ` · ${i.pcs_per_box} pcs per box` : ''}</div><div className="cell-sub">Can return: <strong>{units(i, i.returnable)}</strong></div></td>
                  <td className="right"><input className="input return-qty" inputMode="numeric" placeholder="0" value={qty[i.order_item_id]?.good || ''} onChange={set(i.order_item_id, 'good')} aria-label={`Good quantity of ${i.product_name} ${i.colour} ${i.size}`} /></td>
                  <td className="right"><input className="input return-qty" inputMode="numeric" placeholder="0" value={qty[i.order_item_id]?.damaged || ''} onChange={set(i.order_item_id, 'damaged')} aria-label={`Damaged quantity of ${i.product_name} ${i.colour} ${i.size}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {over.length > 0 && <Alert type="warning">{over[0].product_name}: only {units(over[0], over[0].returnable)} can be returned.</Alert>}
        <Field label="Reason for the return" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. wrong size sent" /></Field>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{data.packing_share > 0 ? 'Credit amount (after less packing)' : 'Credit amount'}</span>
          <strong>{formatINR(credit)}</strong>
        </div>
      </div>
    </Modal>
  );
}

/** Order page: the returns of a handed-over order. */
export default function SalesReturnCard({ orderId, onChanged }) {
  const { data, reload } = useAsync(() => adminApi.get(`/orders/${encodeURIComponent(orderId)}/returns`), [orderId]);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  if (!data?.can_return) return null;
  const refresh = () => { reload(); onChanged(); };
  const canCreate = data.items.some((i) => i.returnable > 0);
  return (
    <section className="card card-pad">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="card-title">Sales returns</h3>
        {canCreate && <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}><Undo2 /> New sales return</button>}
      </div>
      {data.returns.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Return no.</th><th>Date</th><th className="right">Good / Damaged</th><th className="right">Credit</th><th>Made by</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.returns.map((r) => (
                <tr key={r.return_id}>
                  <td className="nowrap"><strong>{r.return_number}</strong><div className="cell-sub">{r.reason}</div></td>
                  <td className="small nowrap">{formatDateTime(r.created_at)}</td>
                  <td className="right num nowrap">{r.good_pcs} / {r.damaged_pcs} pcs</td>
                  <td className="right num"><strong>{formatINR(r.credit_amount)}</strong></td>
                  <td className="small">{r.made_by_name}</td>
                  <td><ReturnStatus status={r.status} /></td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <a className="btn btn-sm" href={creditNoteUrl(r)} download><FileDown /> Credit note</a>
                      {r.status === 'ACTIVE' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCancelling(r)}><Ban /> Cancel</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="small muted mb-0">No sales return on this order.</p>}
      {creating && <NewReturn data={data} orderId={orderId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      <CancelReturnDialog item={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
    </section>
  );
}
