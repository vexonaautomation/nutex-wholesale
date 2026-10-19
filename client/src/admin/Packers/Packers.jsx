import { useState } from 'react';
import { PackageCheck, Pencil, UserPlus } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import {
  Alert, EmptyState, ErrorState, Field, PageLoader, Spinner, StatusBadge,
} from '../../components/common/ui.jsx';

const EMPTY = { name: '', mobile: '', notes: '' };

/** Owner: the people who pack orders (they get packing slips on WhatsApp). */
export default function Packers() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.get('/packers'), []);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const open = (p) => { setEditing(p || {}); setForm(p ? { name: p.name, mobile: p.mobile, notes: p.notes } : EMPTY); setFormError(null); };
  const save = async () => {
    setBusy(true);
    setFormError(null);
    try {
      if (editing.packer_id) await adminApi.put(`/packers/${editing.packer_id}`, { ...form, status: editing.status });
      else await adminApi.post('/packers', form);
      toast.success(editing.packer_id ? 'Saved.' : `${form.name} added to the packing team.`);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (p, status) => {
    try {
      await adminApi.put(`/packers/${p.packer_id}`, { name: p.name, mobile: p.mobile, notes: p.notes, status });
      toast.success(status === 'ACTIVE' ? `${p.name} is back in the list.` : `${p.name} is hidden from the list.`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader
        title="Packing team"
        subtitle={'When you mark an order "Processing", pick who packs it - they get the packing slip (articles, colours, sizes, quantities, address; no amounts) on WhatsApp.'}
        actions={<button type="button" className="btn btn-primary" onClick={() => open(null)}><UserPlus /> Add packer</button>}
      />
      {!data.items.length ? (
        <EmptyState icon={PackageCheck} title="No packers yet">Add the people who pack orders with their WhatsApp number.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>WhatsApp</th><th className="right">Orders packed / open</th><th>Status</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.packer_id}>
                  <td className="cell-main">{p.name}</td>
                  <td className="num">{p.mobile}</td>
                  <td className="right num">{p.orders}{p.packing_now > 0 && <div className="cell-sub">{p.packing_now} open now</div>}</td>
                  <td><StatusBadge kind="record" status={p.status} /></td>
                  <td className="small">{p.notes || '—'}</td>
                  <td className="right nowrap">
                    <button type="button" className="btn btn-sm" onClick={() => open(p)}><Pencil /> Edit</button>{' '}
                    {p.status === 'ACTIVE'
                      ? <button type="button" className="btn btn-sm" onClick={() => setStatus(p, 'INACTIVE')}>Switch off</button>
                      : <button type="button" className="btn btn-sm btn-success" onClick={() => setStatus(p, 'ACTIVE')}>Switch on</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!editing}
        title={editing?.packer_id ? `Edit · ${editing.name}` : 'Add packer'}
        onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy && <Spinner small />} Save</button></>}
      >
        <div className="form-grid">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="WhatsApp number" required hint="The packing slip link is sent here."><input className="input" inputMode="tel" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="10-digit mobile" /></Field>
          <Field label="Notes (optional)" className="span-2"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Godown 2, day shift" /></Field>
        </div>
        {formError && <Alert type="error" className="mt-2">{formError.message}</Alert>}
      </Modal>
    </>
  );
}
