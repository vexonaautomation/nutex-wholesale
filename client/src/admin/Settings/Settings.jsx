import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Save, UserPlus } from 'lucide-react';
import { adminApi, authApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAdmin } from '../AdminApp.jsx';
import { PageHeader, SingleImageUpload } from '../components.jsx';
import { PaymentQrManager } from '../PaymentQrManager.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, ErrorState, Field, PageLoader, Spinner, StatusBadge } from '../../components/common/ui.jsx';
import { POLICY_PAGES, PRICE_DISPLAY_LABELS, SLAB_BASIS_LABELS } from '../../constants/index.js';
import { LEGAL_TEMPLATES } from '../../utils/legal.js';
import { formatDateTime } from '../../utils/format.js';

const TABS = ['Company', 'Pricing & orders', 'Payment', 'Homepage', 'Legal pages', 'Admin users', 'My account', 'System & backup'];

function AdminUsers() {
  const toast = useToast();
  const { admin } = useAdmin();
  const { data, loading, reload } = useAsync(() => adminApi.get('/users'), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'ADMIN', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/users', form);
      toast.success('Admin user created.');
      setOpen(false);
      setForm({ email: '', name: '', role: 'ADMIN', password: '' });
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (u, status) => {
    try {
      await adminApi.post(`/users/${u.admin_id}/status`, { status });
      toast.success('Updated.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };
  if (loading) return <PageLoader />;
  return (
    <div className="stack">
      <div className="row-between"><p className="muted mb-0">Passwords are stored as bcrypt hashes in the Admin_Users sheet.</p><button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><UserPlus /> Add admin</button></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.admin_id}>
                <td className="cell-main">{u.name}</td><td>{u.email}</td><td>{u.role}</td><td><StatusBadge kind="record" status={u.status} /></td>
                <td className="small">{formatDateTime(u.last_login_at)}</td>
                <td className="right">{u.admin_id !== admin.admin_id && (u.status === 'ACTIVE'
                  ? <button type="button" className="btn btn-sm" onClick={() => setStatus(u, 'INACTIVE')}>Deactivate</button>
                  : <button type="button" className="btn btn-sm btn-success" onClick={() => setStatus(u, 'ACTIVE')}>Reactivate</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={open} title="Add admin user" onClose={() => setOpen(false)} footer={<><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" onClick={create} disabled={busy}>{busy && <Spinner small />} Create</button></>}>
        <div className="form-grid">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" required><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role"><select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="STAFF">Staff</option></select></Field>
          <Field label="Temporary password" required hint="Min 10 chars, letters and numbers"><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        {error && <Alert type="error" className="mt-2">{error.message}</Alert>}
      </Modal>
    </div>
  );
}

function MyAccount() {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authApi.changePassword(cur, next);
      toast.success('Password changed. Other sessions have been signed out.');
      setCur('');
      setNext('');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" style={{ maxWidth: 420 }} onSubmit={submit}>
      <Field label="Current password"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
      <Field label="New password" hint="Min 10 characters with letters and numbers"><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required /></Field>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Spinner small />} Change password</button>
    </form>
  );
}

function SystemTab() {
  const sys = useAsync(() => adminApi.get('/system'), []);
  const sheets = useAsync(() => adminApi.get('/export'), []);
  return (
    <div className="stack">
      {sys.data && (
        <dl className="kv">
          <dt>Status</dt><dd>{sys.data.ready ? <span className="badge badge-success">Ready</span> : <span className="badge badge-danger">Not ready</span>} {sys.data.last_error}</dd>
          <dt>Version</dt><dd>{sys.data.version} ({sys.data.node_env})</dd>
          <dt>Database</dt><dd>{sys.data.backend === 'google' ? 'Google Sheets' : sys.data.backend} · schema v{sys.data.migration?.schemaVersion}</dd>
          <dt>File storage</dt><dd>{sys.data.drive.configured ? (sys.data.drive.ready ? 'Google Drive - ready' : 'Google Drive - not reachable') : 'Not configured'}</dd>
          <dt>Started</dt><dd>{formatDateTime(sys.data.started_at)}</dd>
          {sys.data.migration?.errors?.length > 0 && <><dt>Migration errors</dt><dd>{sys.data.migration.errors.join('; ')}</dd></>}
        </dl>
      )}
      <Alert type="info">Backups: In Google Sheets use <strong>File → Make a copy</strong> or <strong>File → Download → Microsoft Excel</strong> regularly, and keep Google Drive version history on. Exports below are read-only and never change data.</Alert>
      <div className="row wrap">
        {(sheets.data?.sheets || []).map((s) => <a key={s} className="btn btn-sm" href={`/api/admin/export/${s}`}><Download /> {s}.csv</a>)}
      </div>
    </div>
  );
}

export default function Settings() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.get('/settings'), []);
  const [tab, setTab] = useState(0);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  // keep unsaved edits when data reloads (e.g. after the QR is changed)
  const lastData = useRef(null);
  useEffect(() => {
    if (!data) return;
    setDraft((prev) => {
      const next = { ...data.settings };
      const old = lastData.current?.settings;
      if (old) {
        for (const d of data.definitions) {
          if (d.key !== 'payment_qr_file_id' && String(prev[d.key] ?? '') !== String(old[d.key] ?? '')) next[d.key] = prev[d.key];
        }
      }
      return next;
    });
    lastData.current = data;
  }, [data]);

  const changed = useMemo(() => {
    if (!data) return {};
    const out = {};
    for (const d of data.definitions) if (String(draft[d.key] ?? '') !== String(data.settings[d.key] ?? '')) out[d.key] = draft[d.key];
    return out;
  }, [draft, data]);

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setSaving(true);
    try {
      const res = await adminApi.put('/settings', changed);
      res.warnings?.forEach((w) => toast.info(w));
      toast.success(`Saved ${Object.keys(res.changed).length} setting(s) to Google Sheets.`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const dirty = Object.keys(changed).length;
  const text = (k, label, hint, extra = {}) => <Field label={label} hint={hint} key={k}><input className="input" value={draft[k] ?? ''} onChange={set(k)} {...extra} /></Field>;
  const area = (k, label, hint, rows = 4) => <Field label={label} hint={hint} className="span-2" key={k}><textarea className="textarea" rows={rows} value={draft[k] ?? ''} onChange={set(k)} /></Field>;

  const panels = [
    <div className="form-grid" key="c">
      {text('company_name', 'Company name')}
      {text('company_tagline', 'Tagline')}
      <div className="span-2"><SingleImageUpload label="Company logo" purpose="logo" exact value={draft.company_logo_file_id} onChange={(id) => setDraft((d) => ({ ...d, company_logo_file_id: id }))} hint="PNG with transparent background recommended. Stored in Drive/BRAND." /></div>
      <div className="span-2"><SingleImageUpload label="Bra size chart" purpose="logo" exact value={draft.size_chart_file_id} onChange={(id) => setDraft((d) => ({ ...d, size_chart_file_id: id }))} hint="Shown as “Size chart” on product pages with bra sizes (28–42). Stored in Drive/BRAND." /></div>
      {text('company_phone', 'Phone')}
      {text('company_email', 'Email')}
      {text('whatsapp_number', 'WhatsApp number', 'With country code, e.g. 919876543210')}
      {text('company_gstin', 'Company GSTIN')}
      {area('company_address', 'Address', '', 3)}
      <h4 className="span-2 mb-0 mt-2">Order bill (PDF)</h4>
      {text('bill_title', 'Bill heading', 'Printed at the top of the bill, e.g. ESTIMATE')}
      {area('bill_terms', 'Bill terms & conditions', 'One per line. Printed at the bottom of every bill. Company name, GSTIN, address and phone above are printed in the bill header.', 4)}
      {text('business_hours', 'Business hours')}
      {text('jurisdiction_city', 'Legal jurisdiction city', 'Used in Terms & Conditions')}
      {area('support_message', 'Support message', 'Shown on homepage & contact page', 2)}
      {text('announcement_text', 'Announcement bar', 'Blank = automatic minimum-order message')}
    </div>,
    <div className="form-grid" key="p">
      <Field label="Minimum order value ₹" hint="Checked on FINAL payable value after discount"><input className="input" inputMode="decimal" value={draft.minimum_order_value ?? ''} onChange={set('minimum_order_value')} /></Field>
      <Field label="Discount mode"><select className="select" value={draft.discount_mode} onChange={set('discount_mode')}><option value="FIXED">Single / fixed discount</option><option value="SLAB">Slab / tier discount</option></select></Field>
      <Field label="Default (fixed) discount %"><input className="input" inputMode="decimal" value={draft.default_discount_percent ?? ''} onChange={set('default_discount_percent')} /></Field>
      <Field label="Slab calculation basis"><select className="select" value={draft.discount_slab_basis} onChange={set('discount_slab_basis')}>{Object.entries(SLAB_BASIS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Price display mode"><select className="select" value={draft.price_display_mode} onChange={set('price_display_mode')}>{Object.entries(PRICE_DISPLAY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Currency"><input className="input" value={draft.currency ?? 'INR'} disabled /></Field>
      {text('order_prefix', 'Order number prefix', 'e.g. NX → NX-20261003-0001', { maxLength: 8, style: { textTransform: 'uppercase' } })}
      <Field label="Low stock threshold"><input className="input" inputMode="numeric" value={draft.low_stock_threshold ?? ''} onChange={set('low_stock_threshold')} /></Field>
      <Field label="Auto-cancel unpaid orders after (hours)" hint="Releases reserved stock. 0 = never. Orders with any payment are never auto-cancelled." className="span-2"><input className="input" inputMode="numeric" value={draft.reservation_expiry_hours ?? ''} onChange={set('reservation_expiry_hours')} /></Field>
      <h4 className="span-2 mb-0 mt-2">Existing customers</h4>
      <Field label="Minimum order for existing customers ₹" hint="0 = no minimum (any quantity). Can be overridden per customer in Existing Customers."><input className="input" inputMode="decimal" value={draft.existing_customer_minimum_order_value ?? ''} onChange={set('existing_customer_minimum_order_value')} /></Field>
      <Field label="Verify existing customers with WhatsApp OTP" hint="Recommended ON. OFF = the mobile number alone is enough (less secure).">
        <select className="select" value={String(draft.existing_customer_otp_enabled)} onChange={(e) => setDraft((d) => ({ ...d, existing_customer_otp_enabled: e.target.value === 'true' }))}>
          <option value="true">ON - send WhatsApp OTP</option>
          <option value="false">OFF - mobile number only</option>
        </select>
      </Field>
      <Field label="Loose pieces for new customers" hint="Existing customers can always choose box or loose pieces. Per article you can open loose pieces for new customers (product wizard step 5 or Products → Box / pieces).">
        <select className="select" value={String(draft.pcs_for_existing_customers_only)} onChange={(e) => setDraft((d) => ({ ...d, pcs_for_existing_customers_only: e.target.value === 'true' }))}>
          <option value="true">Only on articles where I allow it - otherwise full boxes</option>
          <option value="false">Allowed on every article</option>
        </select>
      </Field>
      <Field label="After the first paid order" hint="When you verify a new customer's first payment, add them to Existing Customers automatically.">
        <select className="select" value={String(draft.auto_existing_after_first_order)} onChange={(e) => setDraft((d) => ({ ...d, auto_existing_after_first_order: e.target.value === 'true' }))}>
          <option value="true">Make them an existing customer automatically</option>
          <option value="false">Do nothing - I add existing customers myself</option>
        </select>
      </Field>
      {area('otp_message_template', 'WhatsApp OTP message', '{{otp}} = the code, {{company_name}} = your company name', 3)}
    </div>,
    <div className="form-grid" key="pay">
      <Field label="Online payment (UPI QR) after checkout" className="span-2" hint="OFF = customers see a thank-you page after checkout and your team confirms each order (Orders > Confirm order). Payment is collected outside the website. Orders already placed keep their own mode.">
        <select className="select" value={String(draft.online_payment_enabled !== false)} onChange={(e) => setDraft((d) => ({ ...d, online_payment_enabled: e.target.value === 'true' }))}>
          <option value="true">ON - customers pay by the UPI QR after checkout</option>
          <option value="false">OFF - thank-you page, the team confirms the order</option>
        </select>
      </Field>
      <div className="span-2 card card-pad"><h4 className="mb-1">Company payment QR</h4><p className="small muted">Upload or replace the QR here - it goes live immediately (no need to press Save).</p><PaymentQrManager onSaved={reload} /></div>
      {text('upi_id', 'UPI ID', 'e.g. nutex@okaxis')}
      {text('payment_name', 'Payee / account name')}
      {text('payment_whatsapp_number', 'Payment WhatsApp number', 'Blank = support WhatsApp number')}
      {area('payment_instructions', 'Payment instructions', 'One step per line', 5)}
    </div>,
    <div className="form-grid" key="h">
      {text('hero_title', 'Homepage headline')}
      {area('hero_subtitle', 'Homepage sub-headline', '', 3)}
    </div>,
    <div className="stack" key="l">
      <Alert type="warning">Default templates are provided for convenience. Have them reviewed by your legal/compliance advisor before going live. Placeholders like {'{{company_name}}'} are filled from Company settings.</Alert>
      {POLICY_PAGES.map((p) => (
        <div key={p.key} className="card card-pad">
          <div className="row-between mb-1">
            <strong>{p.title}</strong>
            <span className="row">
              {draft[p.key] ? <span className="badge badge-success">Custom text</span> : <span className="badge badge-warning">Using default template - review required</span>}
              <button type="button" className="btn btn-sm" onClick={() => setDraft((d) => ({ ...d, [p.key]: LEGAL_TEMPLATES[p.key] }))}>Load template to edit</button>
              <a className="btn btn-sm btn-ghost" href={`/policies/${p.slug}`} target="_blank" rel="noopener noreferrer">View</a>
            </span>
          </div>
          <textarea className="textarea" rows={8} value={draft[p.key] ?? ''} onChange={set(p.key)} placeholder="Blank = default template. Supports # headings, - bullet lists and **bold**." />
        </div>
      ))}
    </div>,
    <AdminUsers key="u" />,
    <MyAccount key="a" />,
    <SystemTab key="s" />,
  ];
  const savable = tab <= 4;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Stored in the Settings sheet. Only changed values are written, and every change is audited."
        actions={savable && <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? <Spinner small /> : <Save />} Save{dirty ? ` (${dirty})` : ''}</button>}
      />
      <div className="tabs mb-3" role="tablist">
        {TABS.map((t, i) => <button key={t} type="button" role="tab" className="tab" aria-selected={tab === i} onClick={() => setTab(i)}>{t}</button>)}
      </div>
      <section className="card card-pad">{panels[tab]}</section>
    </>
  );
}
