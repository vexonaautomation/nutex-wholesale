import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react';
import { adminApi } from '../services/auth.js';
import { useAsync } from '../hooks/index.js';
import { useToast } from '../context/ToastContext.jsx';
import { Modal } from '../components/common/Modal.jsx';
import { Alert, EmptyState, ErrorState, PageLoader, Spinner, StatusBadge } from '../components/common/ui.jsx';
import { PageHeader } from './components.jsx';

/**
 * Shared admin screen for master data (categories, colors, sizes):
 * list + add/edit modal + activate/deactivate/archive + reorder.
 * Records are never deleted.
 */
export function MasterTable({ title, subtitle, endpoint, idField, nameField, columns, emptyForm, renderForm, toPayload, allowArchive = false, entity }) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.get(endpoint), [endpoint]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const items = data?.items || [];

  const open = (row) => {
    setEditing(row || {});
    setForm(row ? { ...emptyForm, ...row } : emptyForm);
    setFormError(null);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editing?.[idField]) await adminApi.put(`${endpoint}/${editing[idField]}`, toPayload(form));
      else await adminApi.post(endpoint, toPayload(form));
      toast.success(`${entity} saved.`);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row, status) => {
    setBusyId(row[idField]);
    try {
      await adminApi.post(`${endpoint}/${row[idField]}/status`, { status });
      toast.success(`${row[nameField]} is now ${status.toLowerCase()}.`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const move = async (index, dir) => {
    const ids = items.map((r) => r[idField]);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await adminApi.put(`${endpoint}/reorder`, { ids });
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<button type="button" className="btn btn-primary" onClick={() => open(null)}><Plus /> Add {entity.toLowerCase()}</button>} />
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !items.length ? (
        <EmptyState title={`No ${entity.toLowerCase()} records`} action={<button type="button" className="btn btn-primary" onClick={() => open(null)}>Add {entity.toLowerCase()}</button>}>
          Tip: the Dashboard can load Nutex's initial master data in one click.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th style={{ width: 70 }}>Order</th>{columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}<th>Status</th><th className="right">Actions</th></tr>
            </thead>
            <tbody>
              {items.map((row, i) => (
                <tr key={row[idField]}>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp /></button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown /></button>
                    </div>
                  </td>
                  {columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(row) : row[c.key]}</td>)}
                  <td><StatusBadge kind="record" status={row.status} /></td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      {busyId === row[idField] && <Spinner small />}
                      <button type="button" className="btn btn-sm" onClick={() => open(row)}><Pencil /> Edit</button>
                      {row.status === 'ACTIVE'
                        ? <button type="button" className="btn btn-sm" onClick={() => setStatus(row, 'INACTIVE')}>Deactivate</button>
                        : <button type="button" className="btn btn-sm btn-success" onClick={() => setStatus(row, 'ACTIVE')}>Reactivate</button>}
                      {allowArchive && row.status !== 'ARCHIVED' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStatus(row, 'ARCHIVED')}>Archive</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!editing}
        title={editing?.[idField] ? `Edit ${entity.toLowerCase()}` : `Add ${entity.toLowerCase()}`}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving && <Spinner small />} Save</button>
          </>
        )}
      >
        <div className="stack">
          {renderForm(form, (k, v) => setForm((f) => ({ ...f, [k]: v })), editing)}
          {formError && <Alert type="error">{formError.message}</Alert>}
        </div>
      </Modal>
    </>
  );
}
