import { useState } from 'react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { PageHeader, SearchBox, Pager } from '../components.jsx';
import { EmptyState, ErrorState, PageLoader } from '../../components/common/ui.jsx';
import { formatDateTime } from '../../utils/format.js';

function pretty(v) {
  if (!v) return '';
  try {
    return JSON.stringify(JSON.parse(v), null, 1);
  } catch {
    return v;
  }
}

export default function AuditLog() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q, 300);
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/audit-log${qs({ action, entity_type: entity, q: dq, page, limit: 50 })}`), [action, entity, dq, page]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of every important change (stored in the Audit_Log sheet)." actions={<a className="btn" href="/api/admin/export/Audit_Log">Export CSV</a>} />
      <div className="filter-bar">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Entity ID, admin, notes" />
        <select className="select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action">
          <option value="">All actions</option>
          {(data?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="select" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} aria-label="Entity">
          <option value="">All entities</option>
          {['Product', 'Category', 'Color', 'Size', 'Inventory', 'Discount_Slab', 'Order', 'Payment', 'Settings', 'Admin', 'MasterData', 'Sheet'].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.items.length ? <EmptyState title="No audit entries" /> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Actor</th><th>Old value</th><th>New value</th><th>Reason / notes</th></tr></thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.audit_id}>
                    <td className="small nowrap">{formatDateTime(a.timestamp)}</td>
                    <td><span className="badge badge-outline">{a.action}</span></td>
                    <td className="small">{a.entity_type}<div className="cell-sub">{a.entity_id}</div></td>
                    <td className="small">{a.actor_type}<div className="cell-sub">{a.admin_id}{a.ip ? ` · ${a.ip}` : ''}</div></td>
                    <td><div className="json-cell">{pretty(a.old_value)}</div></td>
                    <td><div className="json-cell">{pretty(a.new_value)}</div></td>
                    <td className="small">{a.reason}{a.reason && a.notes ? <br /> : null}<span className="soft">{a.notes}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </>
  );
}
