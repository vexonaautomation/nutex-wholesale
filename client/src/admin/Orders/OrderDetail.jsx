import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CheckCircle2, ExternalLink, Lock, LockOpen, Truck, XCircle } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, ConfirmDialog } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, ErrorState, Field, PageLoader, Spinner, StatusBadge } from '../../components/common/ui.jsx';
import { OrderTotals } from '../../components/OrderSummary/OrderSummary.jsx';
import { formatDateTime, formatINR, pct } from '../../utils/format.js';
import { ORDER_STATUS } from '../../constants/index.js';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { waLink } from '../../utils/whatsapp.js';

export function ProofModal({ payment, onClose }) {
  const [failed, setFailed] = useState(false);
  if (!payment) return null;
  return (
    <Modal open title={`Payment proof · ${payment.order_number}`} onClose={() => { setFailed(false); onClose(); }} size="lg" footer={<a className="btn" href={payment.proof_view_url} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open in new tab</a>}>
      {failed
        ? <Alert type="info">This proof cannot be previewed here (it may be a PDF). Use “Open in new tab”.</Alert>
        : <img src={payment.proof_view_url} alt="Payment screenshot" className="proof-frame" onError={() => setFailed(true)} />}
    </Modal>
  );
}

export function PaymentDecision({ payment, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState(null);
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn btn-sm btn-success" onClick={() => setMode('verify')}><CheckCircle2 /> Verify</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setMode('reject')}><XCircle /> Reject</button>
      </div>
      <ConfirmDialog
        open={mode === 'verify'}
        title="Verify payment?"
        message={`Confirm that ${formatINR(payment.amount)}${payment.utr ? ` with UTR ${payment.utr}` : ' (no UTR given - check the screenshot)'} has been received in the company account.`}
        confirmLabel="Mark as verified"
        reasonLabel="Remarks (optional)"
        onClose={() => setMode(null)}
        onConfirm={async (remarks) => {
          await adminApi.put(`/payments/${payment.payment_id}/verify`, { remarks });
          toast.success('Payment verified.');
          onDone();
        }}
      />
      <ConfirmDialog
        open={mode === 'reject'}
        title="Reject payment?"
        message="The order stays locked. The customer will see your remarks and can submit corrected payment details."
        confirmLabel="Reject payment"
        danger
        reasonLabel="Reason shown to customer"
        reasonRequired
        onClose={() => setMode(null)}
        onConfirm={async (remarks) => {
          await adminApi.put(`/payments/${payment.payment_id}/reject`, { remarks });
          toast.success('Payment rejected.');
          onDone();
        }}
      />
    </>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, reload, setData } = useAsync(() => adminApi.get(`/orders/${encodeURIComponent(id)}`), [id]);
  const [proof, setProof] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [statusForm, setStatusForm] = useState(null);
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const { order } = data;

  const changeStatus = async () => {
    setSaving(true);
    try {
      const res = await adminApi.put(`/orders/${order.order_id}/status`, statusForm);
      setData(res);
      setStatusForm(null);
      toast.success(`Order moved to ${ORDER_STATUS[res.order.order_status]?.label}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const wa = order.whatsapp_snapshot ? `91${order.whatsapp_snapshot}` : '';

  return (
    <>
      <PageHeader
        title={`Order ${order.order_number}`}
        subtitle={`Placed ${formatDateTime(order.created_at)} · Internal ID ${order.order_id} · Revision ${order.revision}`}
        actions={(
          <>
            <Link to="/admin/orders" className="btn"><ArrowLeft /> Orders</Link>
            {wa && <a className="btn btn-whatsapp" href={waLink(wa, `Hello ${order.customer_name_snapshot}, regarding your Nutex order ${order.order_number}: `)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Customer</a>}
          </>
        )}
      />
      <div className="row wrap mb-2">
        <StatusBadge status={order.order_status} />
        <StatusBadge kind="payment" status={order.payment_status} />
        {order.locked ? <span className="badge badge-dark"><Lock /> Locked {order.locked_at && `· ${formatDateTime(order.locked_at)}`}</span> : <span className="badge badge-outline"><LockOpen /> Editable by customer</span>}
        <span className="badge badge-outline">Stock: {order.stock_state}</span>
        {order.customer_type_snapshot === 'EXISTING' ? <span className="badge badge-success">Existing customer · minimum {order.minimum_order_value_snapshot ? formatINR(order.minimum_order_value_snapshot) : 'not applicable'}</span> : <span className="badge badge-outline">New customer</span>}
      </div>

      <div className="card card-pad mb-3">
        <h3 className="card-title">Actions</h3>
        <div className="row wrap">
          {data.actions.allowed_statuses.map((s) => (
            <button key={s} type="button" className="btn btn-sm btn-dark" onClick={() => setStatusForm({ status: s, note: '', courier_name: order.courier_name || '', tracking_number: order.tracking_number || '', dispatch_note: '' })}>
              {s === 'DISPATCHED' && <Truck />} Mark {ORDER_STATUS[s].label}
            </button>
          ))}
          {data.actions.can_reopen && <button type="button" className="btn btn-sm" onClick={() => setDialog('reopen')}><LockOpen /> Reopen order</button>}
          {data.actions.can_cancel && <button type="button" className="btn btn-sm btn-danger" onClick={() => setDialog('cancel')}><Ban /> Cancel order</button>}
          {!data.actions.allowed_statuses.length && !data.actions.can_reopen && !data.actions.can_cancel && <span className="small muted">No actions available for this status.</span>}
        </div>
        {order.order_status === 'PAYMENT_SUBMITTED' && <p className="small muted mt-1 mb-0">Verify or reject the payment below to continue.</p>}
      </div>

      <div className="adm-grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad">
            <h3 className="card-title">Order items (snapshot)</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Size</th><th>Colour / Box</th><th className="right">Qty</th><th className="right">MRP</th><th className="right">Disc.</th><th className="right">Unit</th><th className="right">Line total</th></tr></thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i.order_item_id}>
                      <td className="small nowrap">{i.sku}</td>
                      <td className="cell-main">{i.product_name}</td>
                      <td className="small">{i.category}</td>
                      <td>{i.size || '—'}</td>
                      <td className="small">{i.color || i.box || '—'}</td>
                      <td className="right num">{i.qty}{i.units_per_box ? <div className="cell-sub">{i.qty * i.units_per_box} pcs</div> : null}</td>
                      <td className="right num">{formatINR(i.mrp_unit)}</td>
                      <td className="right num">{pct(i.discount_percent)}</td>
                      <td className="right num">{formatINR(i.unit_price)}</td>
                      <td className="right num"><strong>{formatINR(i.line_total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.keys(data.item_revisions).length > 1 && (
              <details className="mt-2"><summary className="small link">Show earlier revisions ({Object.keys(data.item_revisions).length - 1})</summary>
                {Object.entries(data.item_revisions).filter(([rev]) => Number(rev) !== order.revision).map(([rev, items]) => (
                  <div key={rev} className="mt-1 small"><strong>Revision {rev}:</strong> {items.map((i) => `${i.product_name} ${[i.color, i.size, i.box].filter(Boolean).join('/')} × ${i.qty}`).join('; ')}</div>
                ))}
              </details>
            )}
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Payments</h3>
            {data.payments.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Submitted</th><th className="right">Amount</th><th>UTR</th><th>Proof</th><th>Status</th><th>Verified</th><th>Remarks</th><th /></tr></thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.payment_id}>
                        <td className="small nowrap">{formatDateTime(p.submitted_at)}</td>
                        <td className="right num"><strong>{formatINR(p.amount)}</strong>{p.expected_amount !== p.amount && <div className="cell-sub">due {formatINR(p.expected_amount)}</div>}</td>
                        <td className="num">{p.utr || '—'}</td>
                        <td>{p.proof_view_url ? <button type="button" className="btn btn-sm" onClick={() => setProof(p)}>View</button> : '—'}</td>
                        <td><StatusBadge kind="payment" status={p.status} /></td>
                        <td className="small">{p.verified_at ? <>{formatDateTime(p.verified_at)}<div className="cell-sub">{p.verified_by}</div></> : '—'}</td>
                        <td className="small">{p.remarks || p.customer_note || '—'}</td>
                        <td>{p.status === 'SUBMITTED' && <PaymentDecision payment={p} onDone={reload} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="small muted mb-0">No payment submitted yet.</p>}
            <div className="row mt-2 small"><span className="muted">Verified total:</span> <strong>{formatINR(data.amount_paid_verified)}</strong> <span className="muted">· Balance due:</span> <strong>{formatINR(data.balance_due)}</strong></div>
          </section>

          <section className="card card-pad">
            <h3 className="card-title">Audit trail</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Time</th><th>Action</th><th>By</th><th>Reason / notes</th></tr></thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.audit_id}>
                      <td className="small nowrap">{formatDateTime(a.timestamp)}</td>
                      <td><span className="badge badge-outline">{a.action}</span></td>
                      <td className="small">{a.actor_type}{a.admin_id ? ` · ${a.admin_id}` : ''}</td>
                      <td className="small">{a.reason || a.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad"><h3 className="card-title">Totals (snapshot)</h3><OrderTotals totals={data.totals} />
            <p className="tiny soft mt-1 mb-0">Discount mode {order.discount_mode_snapshot}{order.discount_mode_snapshot === 'SLAB' ? ` · basis ${order.discount_basis_snapshot} ${formatINR(order.discount_basis_amount)}` : ''}</p>
          </section>
          <section className="card card-pad">
            <h3 className="card-title">Customer</h3>
            <dl className="kv">
              <dt>Name</dt><dd>{order.customer_name_snapshot}</dd>
              <dt>Business</dt><dd>{order.business_name_snapshot}</dd>
              <dt>Mobile</dt><dd><a href={`tel:${order.mobile_snapshot}`}>{order.mobile_snapshot}</a></dd>
              <dt>WhatsApp</dt><dd>{order.whatsapp_snapshot}</dd>
              {order.alternate_mobile_snapshot && <><dt>Alternate mobile</dt><dd>{order.alternate_mobile_snapshot}</dd></>}
              <dt>Email</dt><dd>{order.email_snapshot || '—'}</dd>
              <dt>GSTIN</dt><dd>{order.gstin_snapshot || '—'}</dd>
              <dt>Billing</dt><dd style={{ whiteSpace: 'pre-line' }}>{order.billing_address_snapshot}</dd>
              <dt>Shipping</dt><dd style={{ whiteSpace: 'pre-line' }}>{order.shipping_address_snapshot}</dd>
              <dt>City / State</dt><dd>{order.city_snapshot}, {order.state_snapshot} - {order.pincode_snapshot}</dd>
              {order.order_notes && <><dt>Notes</dt><dd>{order.order_notes}</dd></>}
            </dl>
          </section>
          {(order.courier_name || order.tracking_number || order.cancel_reason) && (
            <section className="card card-pad">
              <h3 className="card-title">Dispatch / cancellation</h3>
              <dl className="kv">
                {order.courier_name && <><dt>Courier</dt><dd>{order.courier_name}</dd></>}
                {order.tracking_number && <><dt>Tracking</dt><dd>{order.tracking_number}</dd></>}
                {order.dispatched_at && <><dt>Dispatched</dt><dd>{formatDateTime(order.dispatched_at)}</dd></>}
                {order.cancel_reason && <><dt>Cancel reason</dt><dd>{order.cancel_reason}</dd></>}
              </dl>
            </section>
          )}
          <section className="card card-pad">
            <h3 className="card-title">Status timeline</h3>
            <ol className="timeline">
              {data.history.map((h) => (
                <li key={h.history_id}>
                  <div className="timeline-title">{ORDER_STATUS[h.to_status]?.label || h.to_status}</div>
                  <div className="timeline-meta">{formatDateTime(h.created_at)} · {h.actor_type}</div>
                  {h.note && <div className="timeline-note">{h.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      <ProofModal key={proof?.payment_id} payment={proof} onClose={() => setProof(null)} />

      <Modal
        open={!!statusForm}
        title={`Mark order ${statusForm ? ORDER_STATUS[statusForm.status]?.label : ''}`}
        onClose={() => setStatusForm(null)}
        footer={<><button type="button" className="btn" onClick={() => setStatusForm(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={changeStatus} disabled={saving}>{saving && <Spinner small />} Confirm</button></>}
      >
        {statusForm && (
          <div className="stack">
            {statusForm.status === 'DISPATCHED' && (
              <div className="form-grid">
                <Field label="Courier name"><input className="input" value={statusForm.courier_name} onChange={(e) => setStatusForm({ ...statusForm, courier_name: e.target.value })} /></Field>
                <Field label="Tracking number"><input className="input" value={statusForm.tracking_number} onChange={(e) => setStatusForm({ ...statusForm, tracking_number: e.target.value })} /></Field>
                <Field label="Dispatch note" className="span-2"><input className="input" value={statusForm.dispatch_note} onChange={(e) => setStatusForm({ ...statusForm, dispatch_note: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Note (visible to the customer in the order timeline)"><textarea className="textarea" value={statusForm.note} onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })} maxLength={500} /></Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={dialog === 'reopen'}
        title={`Reopen order ${order.order_number}?`}
        message="The order will be unlocked and set back to Payment Pending so the customer can edit it. Committed stock goes back to being reserved. This action is recorded in the audit log."
        confirmLabel="Yes, reopen order"
        reasonLabel="Reason for reopening"
        reasonRequired
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          setData(await adminApi.post(`/orders/${order.order_id}/reopen`, { reason, confirm: true }));
          toast.success('Order reopened.');
        }}
      >
        {order.payment_status === 'VERIFIED' && <Alert type="warning">This order has a verified payment of {formatINR(data.amount_paid_verified)}. It stays on record and counts toward the new total.</Alert>}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`Cancel order ${order.order_number}?`}
        message="Reserved or deducted stock will be returned to inventory. Refunds (if any) are handled outside the website."
        confirmLabel="Cancel order"
        danger
        reasonLabel="Cancellation reason (shown to customer)"
        reasonRequired
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          setData(await adminApi.post(`/orders/${order.order_id}/cancel`, { reason }));
          toast.success('Order cancelled and stock released.');
        }}
      />
    </>
  );
}
