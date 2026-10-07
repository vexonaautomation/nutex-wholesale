import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck, Download, ListPlus, Pencil, Plus, Upload,
} from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, SearchBox } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, EmptyState, ErrorState, Field, PageLoader, Spinner, StatusBadge } from '../../components/common/ui.jsx';
import { formatDate, formatINR } from '../../utils/format.js';

const EMPTY = { mobile: '', alternate_mobiles: '', customer_name: '', business_name: '', city: '', gstin: '', minimum_order_value: '', notes: '' };

export default function ExistingCustomers() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/existing-customers${qs({ q: dq })}`), [dq]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const fileRef = useRef(null);

  // CSV saved from Excel -> into the text box (checked before anything is added)
  const readFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 500000) { toast.error('File is too large (max 500 KB, about 3000 customers).'); return; }
    const reader = new FileReader();
    reader.onload = () => { setBulkText(String(reader.result || '')); setBulkResult(null); toast.success(`${file.name} loaded - check the lines, then press "Add numbers".`); };
    reader.onerror = () => toast.error('Could not read the file. Save it as CSV and try again.');
    reader.readAsText(file);
  };

  const open = (row) => {
    setEditing(row || {});
    setForm(row ? { ...EMPTY, ...row, mobile: row.mobile, alternate_mobiles: (row.alternate_mobiles || []).join(', '), minimum_order_value: row.minimum_order_value ?? '' } : EMPTY);
    setFormError(null);
  };

  const save = async () => {
    setBusy(true);
    setFormError(null);
    const payload = { ...form, minimum_order_value: form.minimum_order_value === '' ? null : Number(form.minimum_order_value) };
    try {
      if (editing.key) await adminApi.put(`/existing-customers/${encodeURIComponent(editing.key)}`, { ...payload, mobile: editing.key });
      else await adminApi.post('/existing-customers', payload);
      toast.success('Saved to the Existing_Customers sheet.');
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (row, status) => {
    try {
      await adminApi.put(`/existing-customers/${encodeURIComponent(row.key)}`, { ...row, mobile: row.key, alternate_mobiles: row.alternate_mobiles || [], minimum_order_value: row.minimum_order_value ?? null, status });
      toast.success(status === 'ACTIVE' ? 'Reactivated - no minimum applies again.' : 'Deactivated - standard minimum applies.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const bulk = async () => {
    setBusy(true);
    try {
      const res = await adminApi.post('/existing-customers/bulk', { text: bulkText });
      setBulkResult(res);
      toast.success(`${res.added} customer(s) added.`);
      if (res.added) setBulkText('');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Existing customers"
        subtitle="Customers in this list can order without the standard minimum after verifying any of their numbers (main or alternate) with a WhatsApp OTP."
        actions={(
          <>
            <button type="button" className="btn" onClick={() => { setBulkOpen(true); setBulkResult(null); }}><ListPlus /> Bulk add</button>
            <button type="button" className="btn btn-primary" onClick={() => open(null)}><Plus /> Add customer</button>
          </>
        )}
      />
      {data && (
        <Alert type="info" className="mb-2">
          Minimum for existing customers: <strong>{data.default_minimum ? formatINR(data.default_minimum) : 'none (₹0)'}</strong> · WhatsApp OTP: <strong>{data.otp_enabled ? 'ON' : 'OFF'}</strong> · <Link className="link" to="/admin/settings">Change in Settings</Link>.
          {' '}You can also type rows directly in the Google Sheet <strong>Existing_Customers</strong> (column A = mobile number, status blank = active). Sheet edits show on the website within about a minute.
        </Alert>
      )}
      {data?.duplicates?.length > 0 && <Alert type="warning" className="mb-2">Duplicate numbers in the sheet: {data.duplicates.join(', ')}. Keep only one row per number.</Alert>}
      <div className="filter-bar"><SearchBox value={q} onChange={setQ} placeholder="Mobile, name, business, city" /></div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : !data.items.length ? (
        <EmptyState icon={BadgeCheck} title="No existing customers yet" action={<button type="button" className="btn btn-primary" onClick={() => setBulkOpen(true)}>Bulk add numbers</button>}>
          Add the mobile numbers of customers who already buy from Nutex.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mobile numbers</th><th>Customer</th><th>City</th><th className="right">Minimum</th><th className="right">Website orders</th><th>Status</th><th>Added</th><th className="right">Actions</th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.key}>
                  <td className="num">
                    {r.valid_mobile ? <strong>{r.mobile}</strong> : <span style={{ color: 'var(--danger-700)' }}>{r.key} (invalid)</span>}
                    {r.alternate_mobiles?.length > 0 && <div className="cell-sub">Alt: {r.alternate_mobiles.join(', ')}</div>}
                  </td>
                  <td><div className="cell-main">{r.business_name || r.customer_name || '—'}</div>{r.business_name && <div className="cell-sub">{r.customer_name}</div>}</td>
                  <td className="small">{r.city || '—'}</td>
                  <td className="right">{r.minimum_order_value === null || r.minimum_order_value === undefined ? <span className="soft small">default</span> : formatINR(r.minimum_order_value)}</td>
                  <td className="right num">{r.order_count}<div className="cell-sub">{r.last_order_at ? formatDate(r.last_order_at) : ''}</div></td>
                  <td><StatusBadge kind="record" status={r.status} /></td>
                  <td className="small">{formatDate(r.added_at)}<div className="cell-sub">{r.added_by}</div></td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => open(r)}><Pencil /> Edit</button>
                      {r.status === 'ACTIVE'
                        ? <button type="button" className="btn btn-sm" onClick={() => setStatus(r, 'INACTIVE')}>Deactivate</button>
                        : <button type="button" className="btn btn-sm btn-success" onClick={() => setStatus(r, 'ACTIVE')}>Reactivate</button>}
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
        title={editing?.key ? 'Edit existing customer' : 'Add existing customer'}
        onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy && <Spinner small />} Save</button></>}
      >
        <div className="form-grid">
          <Field label="Mobile number" required hint={editing?.key ? 'The number cannot be changed - add a new row instead' : '10-digit Indian mobile (WhatsApp)'}>
            <input className="input" inputMode="tel" value={form.mobile} disabled={!!editing?.key} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </Field>
          <Field label="Alternate numbers (optional)" hint="Other WhatsApp numbers of the same customer, separated by commas. Any of them can be used to log in."><input className="input" inputMode="tel" value={form.alternate_mobiles} onChange={(e) => setForm({ ...form, alternate_mobiles: e.target.value })} placeholder="9123456789, 9988776655" /></Field>
          <Field label="Customer name"><input className="input" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></Field>
          <Field label="Business / shop name"><input className="input" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></Field>
          <Field label="City"><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="GSTIN (optional)"><input className="input" value={form.gstin} maxLength={15} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} /></Field>
          <Field label="Own minimum order ₹ (optional)" hint="Blank = default for existing customers"><input className="input" inputMode="numeric" value={form.minimum_order_value ?? ''} onChange={(e) => setForm({ ...form, minimum_order_value: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="Notes" className="span-2"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        {formError && <Alert type="error" className="mt-2">{formError.message}</Alert>}
      </Modal>

      <Modal
        open={bulkOpen}
        title="Bulk add existing customers"
        size="lg"
        onClose={() => setBulkOpen(false)}
        footer={<><button type="button" className="btn" onClick={() => setBulkOpen(false)}>Close</button><button type="button" className="btn btn-primary" onClick={bulk} disabled={busy || !bulkText.trim()}>{busy && <Spinner small />} Add numbers</button></>}
      >
        <div className="stack">
          <div className="card card-pad" style={{ background: 'var(--ink-50)' }}>
            <strong>Import from Excel - 3 steps</strong>
            <ol className="small mb-0" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li><a className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} href="/templates/existing-customers-template.csv" download="nutex-existing-customers-template.csv"><Download size={14} /> Download the template</a> and open it in Excel.</li>
              <li>Fill one customer per row (only <strong>mobile</strong> is required) and delete the 2 example rows. Columns: mobile, customer_name, business_name, city, alternate_mobiles (several: <code>/</code>), gstin, minimum_order_value (blank = default), notes.</li>
              <li>Select the whole table incl. the header row → copy → paste below. Or save as CSV and <button type="button" className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => fileRef.current?.click()}><Upload size={14} /> upload the CSV file</button>.</li>
            </ol>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.txt,text/plain" className="sr-only" onChange={readFile} />
          </div>
          <p className="small muted mb-0">Without a header row each line is read as <code>mobile, name, business, city, alternate numbers</code>. Numbers already in the list are skipped - nothing is overwritten.</p>
          <textarea className="textarea" rows={10} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={'mobile\tcustomer_name\tbusiness_name\tcity\n9876543210\tRiya Sharma\tRiya Fashion\tPune\n\n- or -\n9876543210, Riya Sharma, Riya Fashion, Pune, 9123456789'} />
          {bulkText.trim() && <p className="tiny soft mb-0">{bulkText.trim().split(/\r?\n/).filter((l) => l.trim()).length} line(s) ready</p>}
          {bulkResult && (
            <Alert type={bulkResult.skipped.length ? 'warning' : 'success'}>
              Added {bulkResult.added}. {bulkResult.skipped.length > 0 && `Skipped ${bulkResult.skipped.length}: ${bulkResult.skipped.slice(0, 8).map((s) => `${s.mobile || '?'} (${s.reason})`).join(', ')}${bulkResult.skipped.length > 8 ? '…' : ''}`}
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
}
