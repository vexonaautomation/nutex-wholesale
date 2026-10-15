import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, ClipboardList, LayoutDashboard, Pencil, ShieldCheck, UserPlus,
} from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import {
  Alert, EmptyState, ErrorState, Field, PageLoader, Spinner, StatusBadge,
} from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';

const EMPTY = { name: '', mobile: '', email: '', password: '', permissions: ['payments'] };
const SHORT = {
  payments: 'Payments', customers: 'Customers', products: 'Products', inventory: 'Inventory', pricing: 'Discounts', reports: 'Full dashboard',
};

// What every sub admin always has (cannot be switched off)
const ALWAYS = [
  [ClipboardList, 'Orders tab - full access', 'See every order, edit items, change status, download the bill, cancel / reopen.'],
  [LayoutDashboard, 'Dashboard', 'Pending orders and sale value (all orders + the ones they made).'],
];

function SubAdminForm({ open, editing, options, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const key = open ? editing?.admin_id || 'new' : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setForm(editing ? { name: editing.name, mobile: editing.mobile, email: editing.email || '', password: '', permissions: editing.permissions || [] } : EMPTY);
    setError(null);
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (p) => setForm((f) => ({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) await adminApi.put(`/sub-admins/${editing.admin_id}`, form);
      else await adminApi.post('/sub-admins', form);
      toast.success(editing ? 'Sub admin updated.' : `Sub admin added. They sign in with ${form.mobile.replace(/\D/g, '').slice(-10)} and the password you set.`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? `Edit sub admin · ${editing.name}` : 'Add sub admin'}
      onClose={onClose}
      size="lg"
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy && <Spinner small />} {editing ? 'Save changes' : 'Add sub admin'}</button></>}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Name" required><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
          <Field label="Mobile number" required hint="They sign in with this number. Orders they make with it show their name.">
            <input className="input" value={form.mobile} onChange={set('mobile')} inputMode="tel" placeholder="10-digit mobile" />
          </Field>
          <Field label={editing ? 'New password' : 'Password'} required={!editing} hint={editing ? 'Leave blank to keep the current password.' : 'Min 10 characters, letters and numbers. Share it with them.'}>
            <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
          <Field label="Email (optional)"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>

        <div>
          <h4 className="mb-1">What they can see</h4>
          <div className="perm-list">
            {ALWAYS.map(([Icon, title, text]) => (
              <div key={title} className="perm is-fixed">
                <input type="checkbox" checked disabled aria-label={title} />
                <Icon /><span><strong>{title}</strong><span className="small muted">{text}</span></span>
                <span className="badge badge-outline">Always</span>
              </div>
            ))}
            {options.map((o) => (
              <label key={o.key} className={`perm ${form.permissions.includes(o.key) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={form.permissions.includes(o.key)} onChange={() => toggle(o.key)} aria-label={o.label} />
                <ShieldCheck /><span><strong>{o.label}</strong></span>
              </label>
            ))}
          </div>
          <p className="tiny soft mt-1 mb-0">Settings, admin users, sub admins, audit log, catalogue import and CSV export are for the owner only.</p>
        </div>
        {error && <Alert type="error">{error.message}</Alert>}
      </div>
    </Modal>
  );
}

/** Owner: add sub admins (name + mobile) and choose what each one sees. */
export default function SubAdmins() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.get('/sub-admins'), []);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const setStatus = async (u, status) => {
    try {
      await adminApi.post(`/users/${u.admin_id}/status`, { status });
      toast.success(status === 'ACTIVE' ? `${u.name} can sign in again.` : `${u.name} is switched off and signed out.`);
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
        title="Sub admins"
        subtitle="Your team: they sign in with their mobile number and see the Orders tab + what you allow. Every order made with their number shows their name."
        actions={<button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true); }}><UserPlus /> Add sub admin</button>}
      />
      {!data.items.length ? (
        <EmptyState icon={UserPlus} title="No sub admins yet">
          Add a team member with their name and mobile number. They get the Orders tab and a small dashboard (pending orders, sale value) - you choose what else they see.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Mobile (login)</th><th>Can see</th><th className="right">Orders made</th><th>Status</th><th>Last login</th><th /></tr></thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.admin_id}>
                  <td><div className="cell-main">{u.name}</div>{u.email && <div className="cell-sub">{u.email}</div>}</td>
                  <td className="num">{u.mobile}</td>
                  <td>
                    <div className="chip-row">
                      <span className="badge badge-gold"><CheckCircle2 size={12} /> Orders</span>
                      <span className="badge badge-gold"><CheckCircle2 size={12} /> Dashboard</span>
                      {u.permissions.map((p) => <span key={p} className="badge badge-outline">{SHORT[p] || p}</span>)}
                    </div>
                  </td>
                  <td className="right num">
                    {u.orders ? <Link className="link" to={`/admin/orders?placed_by=${u.mobile}`}>{u.orders} orders</Link> : <span className="soft">0</span>}
                    {u.order_value > 0 && <div className="cell-sub">{formatINR(u.order_value)}</div>}
                  </td>
                  <td><StatusBadge kind="record" status={u.status} /></td>
                  <td className="small">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}</td>
                  <td className="right nowrap">
                    <button type="button" className="btn btn-sm" onClick={() => { setEditing(u); setOpen(true); }}><Pencil /> Edit</button>{' '}
                    {u.status === 'ACTIVE'
                      ? <button type="button" className="btn btn-sm" onClick={() => setStatus(u, 'INACTIVE')}>Switch off</button>
                      : <button type="button" className="btn btn-sm btn-success" onClick={() => setStatus(u, 'ACTIVE')}>Switch on</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SubAdminForm open={open} editing={editing} options={data.permission_options} onClose={() => setOpen(false)} onSaved={reload} />
    </>
  );
}
