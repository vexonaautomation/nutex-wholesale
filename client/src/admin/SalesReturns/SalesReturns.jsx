import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, FileDown, Undo2 } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { PageHeader } from '../components.jsx';
import {
  EmptyState, ErrorState, PageLoader,
} from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';
import { CancelReturnDialog, ReturnStatus, creditNoteUrl } from '../Orders/SalesReturn.jsx';

/** All sales returns. A new return is made from a handed-over order. */
export default function SalesReturns() {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/sales-returns?q=${encodeURIComponent(q)}`), [q]);
  const [cancelling, setCancelling] = useState(null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Sales returns" subtitle="To make a return, open a handed-over order and choose New sales return." />
      <div className="card card-pad mb-3 row wrap" style={{ justifyContent: 'space-between' }}>
        <input className="input grow" style={{ maxWidth: 340 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search return no., bill no., party, mobile" aria-label="Search sales returns" />
        {data && <span className="small">Active credit: <strong>{formatINR(data.total_credit)}</strong></span>}
      </div>
      {loading && !data ? <PageLoader /> : data.items.length ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Return no.</th><th>Bill no.</th><th>Party</th><th>Date</th><th className="right">Good / Damaged</th><th className="right">Credit</th><th>Made by</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.return_id}>
                  <td className="nowrap"><strong>{r.return_number}</strong></td>
                  <td className="nowrap"><Link className="link" to={`/admin/orders/${encodeURIComponent(r.order_id)}`}>{r.order_number}</Link></td>
                  <td className="cell-main">{r.party_name}<div className="cell-sub">{r.reason}</div></td>
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
      ) : <EmptyState icon={Undo2} title="No sales returns" message={q ? 'Nothing matches this search.' : 'Returns made from handed-over orders appear here.'} />}
      <CancelReturnDialog item={cancelling} onClose={() => setCancelling(null)} onDone={reload} />
    </>
  );
}
