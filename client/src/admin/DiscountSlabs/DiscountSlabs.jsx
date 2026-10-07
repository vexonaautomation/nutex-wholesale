import { useState } from 'react';
import { Calculator, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, ConfirmDialog } from '../components.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, ErrorState, Field, PageLoader, Spinner } from '../../components/common/ui.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { SLAB_BASIS_LABELS } from '../../constants/index.js';

const EMPTY = { label: '', min_amount: '', max_amount: '', discount_percent: '', priority: 1, active: true, start_date: '', end_date: '' };

export default function DiscountSlabs() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.get('/discount-slabs'), []);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [settingBusy, setSettingBusy] = useState(false);
  const [previewAmt, setPreviewAmt] = useState('15000');
  const [preview, setPreview] = useState(null);
  const [fixedPct, setFixedPct] = useState('');

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const updateSetting = async (patch) => {
    setSettingBusy(true);
    try {
      const r = await adminApi.put('/settings', patch);
      r.warnings?.forEach((w) => toast.info(w));
      toast.success('Discount settings saved.');
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSettingBusy(false);
    }
  };

  const open = (slab) => {
    setEditing(slab || {});
    setForm(slab ? { ...EMPTY, ...slab, max_amount: slab.max_amount ?? '' } : EMPTY);
    setFormError(null);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    const payload = {
      label: form.label,
      min_amount: Number(form.min_amount),
      max_amount: form.max_amount === '' || form.max_amount === null ? null : Number(form.max_amount),
      discount_percent: Number(form.discount_percent),
      priority: Number(form.priority) || 1,
      active: !!form.active,
      start_date: form.start_date || '',
      end_date: form.end_date || '',
    };
    try {
      if (editing.slab_id) await adminApi.put(`/discount-slabs/${editing.slab_id}`, payload);
      else await adminApi.post('/discount-slabs', payload);
      toast.success('Slab saved.');
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s) => {
    try {
      await adminApi.post(`/discount-slabs/${s.slab_id}/${s.active ? 'deactivate' : 'reactivate'}`);
      toast.success(s.active ? 'Slab deactivated.' : 'Slab reactivated.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const runPreview = async () => {
    try {
      setPreview(await adminApi.post('/discount-slabs/preview', { mrp_amount: Number(previewAmt) || 0 }));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const slabMode = data.discount_mode === 'SLAB';
  return (
    <>
      <PageHeader title="Discount slabs" subtitle="Fixed discount or unlimited tiered slabs. Minimum order is a separate rule checked on the final payable value." actions={<button type="button" className="btn btn-primary" onClick={() => open(null)}><Plus /> Add slab</button>} />
      <div className="adm-grid-2 mb-3">
        <section className="card card-pad">
          <h3 className="card-title">Discount system</h3>
          <div className="choice-grid">
            <button type="button" className="choice" aria-pressed={!slabMode} disabled={settingBusy} onClick={() => slabMode && updateSetting({ discount_mode: 'FIXED' })}>
              <span><strong>Single / fixed discount</strong><span className="small muted">Every product gets {pct(data.default_discount_percent)} off MRP.</span></span>
            </button>
            <button type="button" className="choice" aria-pressed={slabMode} disabled={settingBusy} onClick={() => !slabMode && updateSetting({ discount_mode: 'SLAB' })}>
              <span><strong>Slab / tier discount</strong><span className="small muted">Discount depends on cart value using the slabs below.</span></span>
            </button>
          </div>
          <div className="form-grid mt-2">
            <Field label="Fixed discount %" hint="Used in fixed mode (and as base for the pre-discount basis)">
              <div className="input-group">
                <input className="input" inputMode="decimal" placeholder={String(data.default_discount_percent)} value={fixedPct} onChange={(e) => setFixedPct(e.target.value.replace(/[^\d.]/g, ''))} />
                <button type="button" className="btn" disabled={!fixedPct || settingBusy} onClick={() => { updateSetting({ default_discount_percent: Number(fixedPct) }); setFixedPct(''); }}>Save</button>
              </div>
            </Field>
            <Field label="Slab calculation basis">
              <select className="select" value={data.discount_slab_basis} disabled={settingBusy} onChange={(e) => updateSetting({ discount_slab_basis: e.target.value })}>
                {Object.entries(SLAB_BASIS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          </div>
          {data.discount_slab_basis === 'FINAL_PAYABLE' && (
            <Alert type="info" className="mt-2">Final payable basis uses a deterministic rule: a slab applies when the final payable <em>after that slab’s own discount</em> reaches its minimum. The highest qualifying discount wins - no circular pricing.</Alert>
          )}
          {data.discount_slab_basis === 'PRE_DISCOUNT_WHOLESALE_SUBTOTAL' && (
            <Alert type="info" className="mt-2">Basis = MRP × (1 − {pct(data.default_discount_percent)}) - the cart value at the standard fixed wholesale price, before the slab discount.</Alert>
          )}
          <p className="small muted mt-2 mb-0">Minimum order: <strong>{formatINR(data.minimum_order_value)}</strong> on final payable value (change in Settings).</p>
        </section>
        <section className="card card-pad">
          <h3 className="card-title"><Calculator /> Test calculator</h3>
          <div className="input-group">
            <input className="input" inputMode="decimal" value={previewAmt} onChange={(e) => setPreviewAmt(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Cart MRP value" />
            <button type="button" className="btn btn-dark" onClick={runPreview}>Calculate</button>
          </div>
          <p className="tiny soft mt-1">Cart MRP value. Uses the live settings and slabs, exactly like checkout.</p>
          {preview && (
            <dl className="kv mt-2">
              <dt>Mode / basis</dt><dd>{preview.discount_mode} · {formatINR(preview.discount_basis_amount)}</dd>
              <dt>Applied discount</dt><dd>{pct(preview.discount_percent)}{preview.current_slab ? ` (slab ${formatINR(preview.current_slab.min_amount)}+)` : ''}</dd>
              <dt>Discount amount</dt><dd>{formatINR(preview.discount_amount)}</dd>
              <dt>Final payable</dt><dd><strong>{formatINR(preview.final_payable)}</strong></dd>
              <dt>Minimum order</dt><dd>{preview.minimum_order_met ? <span className="badge badge-success">Met</span> : <span className="badge badge-warning">Short by {formatINR(preview.amount_to_minimum)}</span>}</dd>
              {preview.next_slab && <><dt>Next slab</dt><dd>{pct(preview.next_slab.discount_percent)} - add {formatINR(preview.mrp_to_next_slab)} MRP</dd></>}
            </dl>
          )}
        </section>
      </div>

      {data.warnings.length > 0 && slabMode && (
        <div className="stack mb-2" style={{ gap: 8 }}>{data.warnings.map((w) => <Alert key={w} type="warning">{w}</Alert>)}</div>
      )}
      {!slabMode && <Alert type="info" className="mb-2">Slab system is OFF. Slabs below are stored but not applied until you switch to slab mode.</Alert>}

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Range (cart basis)</th><th className="right">Discount</th><th>Label</th><th>Priority</th><th>Dates</th><th>Status</th><th className="right">Actions</th></tr></thead>
          <tbody>
            {data.slabs.length ? data.slabs.map((s) => (
              <tr key={s.slab_id}>
                <td className="cell-main num">{formatINR(s.min_amount)} – {s.max_amount === null ? 'and above' : formatINR(s.max_amount)}</td>
                <td className="right"><strong>{pct(s.discount_percent)}</strong></td>
                <td className="small">{s.label || '—'}</td>
                <td>{s.priority}</td>
                <td className="small">{s.start_date || s.end_date ? `${s.start_date || '…'} → ${s.end_date || '…'}` : 'Always'}</td>
                <td>{s.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-warning">Inactive</span>}</td>
                <td className="right">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => open(s)}><Pencil /> Edit</button>
                    <button type="button" className="btn btn-sm" onClick={() => toggle(s)}>{s.active ? 'Deactivate' : 'Reactivate'}</button>
                    <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => setToDelete(s)} aria-label="Delete slab"><Trash2 /></button>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={7} className="center muted">No slabs yet. Example: ₹0–₹4,999 → 40%, ₹5,000–₹9,999 → 50%, ₹10,000–₹19,999 → 55%, ₹20,000+ → 60%.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!editing}
        title={editing?.slab_id ? 'Edit slab' : 'Add slab'}
        onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving && <Spinner small />} Save slab</button></>}
      >
        <div className="form-grid">
          <Field label="Minimum amount ₹" required hint="Whole rupees, inclusive"><input className="input" inputMode="numeric" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Maximum amount ₹" hint="Inclusive. Leave blank for “and above”"><input className="input" inputMode="numeric" value={form.max_amount ?? ''} onChange={(e) => setForm({ ...form, max_amount: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Discount %" required><input className="input" inputMode="decimal" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="Priority" hint="1 = highest; used only to break ties"><input className="input" type="number" min={1} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></Field>
          <Field label="Start date (optional)"><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
          <Field label="End date (optional)"><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></Field>
          <Field label="Label (optional)" className="span-2"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Gold tier" /></Field>
          <label className="check span-2"><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
        </div>
        {formError && <Alert type="error" className="mt-2">{formError.message}</Alert>}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete slab?"
        message="Allowed only if no order ever used this slab - otherwise deactivate it. The record is kept in the sheet (marked deleted) for audit."
        confirmLabel="Delete"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await adminApi.del(`/discount-slabs/${toDelete.slab_id}`);
          toast.success('Slab deleted.');
          reload();
        }}
      />
    </>
  );
}
