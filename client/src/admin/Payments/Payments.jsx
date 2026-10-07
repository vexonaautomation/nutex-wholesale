import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { PageHeader, SearchBox, Pager } from '../components.jsx';
import { EmptyState, ErrorState, PageLoader, StatusBadge } from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';
import { PAYMENT_STATUS } from '../../constants/index.js';
import { PaymentDecision, ProofModal } from '../Orders/OrderDetail.jsx';
import { PaymentQrButton } from '../PaymentQrManager.jsx';

export default function Payments() {
  const [status, setStatus] = useState('SUBMITTED');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [proof, setProof] = useState(null);
  const dq = useDebounce(q, 300);
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/payments${qs({ status, q: dq, page })}`), [status, dq, page]);

  return (
    <>
      <PageHeader title="Payments" subtitle="Check each UTR in the company bank/UPI statement before verifying." actions={<><PaymentQrButton /><a className="btn" href="/api/admin/export/Payments">Export CSV</a></>} />
      <div className="status-tabs">
        <button type="button" className="status-tab" aria-pressed={!status} onClick={() => { setStatus(''); setPage(1); }}>All</button>
        {Object.entries(PAYMENT_STATUS).filter(([k]) => k !== 'PENDING').map(([k, v]) => (
          <button key={k} type="button" className="status-tab" aria-pressed={status === k} onClick={() => { setStatus(k); setPage(1); }}>{v.label} <b>{data?.counts?.[k] || 0}</b></button>
        ))}
      </div>
      <div className="filter-bar"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Order no, UTR, customer, mobile" /></div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.items.length ? (
        <EmptyState icon={CreditCard} title="No payments here">Customer payment submissions appear here for verification.</EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Submitted</th><th>Order</th><th>Customer</th><th className="right">Amount</th><th>UTR</th><th>Proof</th><th>Status</th><th>Verified by</th><th /></tr></thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.payment_id}>
                    <td className="small nowrap">{formatDateTime(p.submitted_at)}</td>
                    <td><Link className="cell-main" to={`/admin/orders/${p.order_id}`}>{p.order_number}</Link><div className="cell-sub">{p.order_status}</div></td>
                    <td><div className="cell-main">{p.business_name}</div><div className="cell-sub">{p.customer_name} · {p.mobile}</div></td>
                    <td className="right num"><strong>{formatINR(p.amount)}</strong>{p.remarks && p.status === 'SUBMITTED' && <div className="cell-sub" style={{ color: 'var(--warning-700)' }}>{p.remarks}</div>}</td>
                    <td className="num">{p.utr || '—'}</td>
                    <td>{p.proof_view_url ? <button type="button" className="btn btn-sm" onClick={() => setProof(p)}>View</button> : '—'}</td>
                    <td><StatusBadge kind="payment" status={p.status} /></td>
                    <td className="small">{p.verified_by || '—'}</td>
                    <td>{p.status === 'SUBMITTED' && <PaymentDecision payment={p} onDone={reload} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
      <ProofModal key={proof?.payment_id} payment={proof} onClose={() => setProof(null)} />
    </>
  );
}
