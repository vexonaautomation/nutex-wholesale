import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Users } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, SearchBox } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, EmptyState, ErrorState, PageLoader, Spinner, StatusBadge } from '../../components/common/ui.jsx';
import { formatDate, formatDateTime, formatINR } from '../../utils/format.js';

function CustomerModal({ id, onClose, onChanged }) {
  const { data, loading, reload } = useAsync(() => (id ? adminApi.get(`/customers/${id}`) : Promise.resolve(null)), [id]);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const markExisting = async () => {
    const c = data.customer;
    setBusy(true);
    try {
      await adminApi.post('/existing-customers', {
        mobile: c.mobile, alternate_mobiles: c.alternate_mobile || '', customer_name: c.customer_name, business_name: c.business_name, city: c.city, gstin: c.gstin,
      });
      toast.success('Added to existing customers - no minimum order for this number.');
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!id} title={data?.customer?.business_name || 'Customer'} onClose={onClose} size="lg">
      {loading || !data ? <PageLoader /> : (
        <div className="stack">
          {data.customer.is_existing ? (
            <Alert type="success">Existing customer - can order without the standard minimum (after WhatsApp verification).</Alert>
          ) : (
            <div className="existing-cta">
              <BadgeCheck />
              <div className="grow small">Regular customer? Mark as existing so they can order any quantity.</div>
              <button type="button" className="btn btn-sm btn-success" onClick={markExisting} disabled={busy}>{busy && <Spinner small />} Mark as existing customer</button>
            </div>
          )}
          <dl className="kv">
            <dt>Name</dt><dd>{data.customer.customer_name}</dd>
            <dt>Mobile / WhatsApp</dt><dd>{data.customer.mobile} / {data.customer.whatsapp}</dd>
            {data.customer.alternate_mobile && <><dt>Alternate mobile</dt><dd>{data.customer.alternate_mobile}</dd></>}
            <dt>Email</dt><dd>{data.customer.email || '—'}</dd>
            <dt>GSTIN</dt><dd>{data.customer.gstin || '—'}</dd>
            <dt>Address</dt><dd style={{ whiteSpace: 'pre-line' }}>{data.customer.billing_address}<br />{data.customer.city}, {data.customer.state} - {data.customer.pincode}</dd>
            <dt>Orders / value</dt><dd>{data.customer.order_count} · {formatINR(data.customer.total_value)}</dd>
          </dl>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order</th><th>Date</th><th className="right">Value</th><th>Status</th><th>Payment</th></tr></thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.order_id}>
                    <td><Link className="cell-main" to={`/admin/orders/${o.order_id}`} onClick={onClose}>{o.order_number}</Link></td>
                    <td className="small">{formatDateTime(o.created_at)}</td>
                    <td className="right num">{formatINR(o.final_payable)}</td>
                    <td><StatusBadge status={o.order_status} /></td>
                    <td><StatusBadge kind="payment" status={o.payment_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Customers() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const dq = useDebounce(q, 300);
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/customers${qs({ q: dq })}`), [dq]);
  return (
    <>
      <PageHeader title="Customers" subtitle="Created automatically from checkout (matched by mobile number). Orders keep their own snapshot of these details." actions={<a className="btn" href="/api/admin/export/Customers">Export CSV</a>} />
      <div className="filter-bar"><SearchBox value={q} onChange={setQ} placeholder="Name, business, mobile, city, GSTIN" /></div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.items.length ? (
        <EmptyState icon={Users} title="No customers yet" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Business</th><th>Type</th><th>Contact</th><th>City</th><th>GSTIN</th><th className="right">Orders</th><th className="right">Total value</th><th>Last order</th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.customer_id} className="is-clickable" onClick={() => setOpen(c.customer_id)}>
                  <td><div className="cell-main">{c.business_name}</div><div className="cell-sub">{c.customer_name}</div></td>
                  <td>{c.is_existing ? <span className="badge badge-success">Existing</span> : <span className="badge badge-outline">New</span>}</td>
                  <td className="small">{c.mobile}{c.email && <div className="cell-sub">{c.email}</div>}</td>
                  <td className="small">{c.city}, {c.state}</td>
                  <td className="small">{c.gstin || '—'}</td>
                  <td className="right num">{c.order_count}</td>
                  <td className="right num">{formatINR(c.total_value)}</td>
                  <td className="small">{formatDate(c.last_order_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CustomerModal id={open} onClose={() => setOpen(null)} onChanged={reload} />
    </>
  );
}
