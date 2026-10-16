import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp } from 'lucide-react';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Spinner } from '../../components/common/ui.jsx';
import { useToast } from '../../context/ToastContext.jsx';

// Existing customers with Excel: download the template, fill it, upload it,
// check every row (new / updated / errors with the Excel row number), apply.
async function upload(buffer, apply) {
  const res = await fetch(`/api/admin/existing-customers/import${apply ? '?apply=1' : ''}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'X-Requested-With': 'NutexAdmin',
      Accept: 'application/json',
    },
    body: buffer,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || 'Upload failed.');
  return body;
}

const FIELD_LABEL = {
  customer_name: 'name', business_name: 'business', city: 'city', address: 'address', state: 'state', pincode: 'pincode', gstin: 'GSTIN', status: 'reactivated',
};
const SHOW = 100;

function RowTable({ rows, extra }) {
  if (!rows.length) return null;
  return (
    <div className="table-wrap" style={{ maxHeight: 260 }}>
      <table className="table">
        <thead><tr><th>Excel row</th><th>Mobile</th><th>Customer</th>{extra && <th>{extra.label}</th>}</tr></thead>
        <tbody>
          {rows.slice(0, SHOW).map((r) => (
            <tr key={`${r.row}-${r.mobile}`}>
              <td className="num">{r.row ?? '—'}</td>
              <td className="num">{r.mobile || '—'}</td>
              <td>{r.name || '—'}</td>
              {extra && <td className="small">{extra.value(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > SHOW && <p className="tiny soft mt-1 mb-0">+ {rows.length - SHOW} more</p>}
    </div>
  );
}

export function ExcelImportDialog({ open, onClose, onDone }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [buffer, setBuffer] = useState(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => { setBuffer(null); setFileName(''); setPreview(null); setDone(null); setError(null); };
  const close = () => { reset(); onClose(); };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) { setError(new Error('Upload the Excel file (.xlsx) - download the template first.')); return; }
    if (file.size > 10 * 1024 * 1024) { setError(new Error('File is too large (max 10 MB).')); return; }
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      setBuffer(buf);
      setPreview(await upload(buf, false));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await upload(buffer, true);
      setDone(res);
      toast.success(`${res.add.length} added · ${res.update.length} updated.`);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const view = done || preview;
  const toSave = preview ? preview.add.length + preview.update.length : 0;
  return (
    <Modal
      open={open}
      title={done ? 'Customers saved' : 'Import existing customers from Excel'}
      size="lg"
      onClose={close}
      footer={done ? <button type="button" className="btn btn-primary" onClick={close}>Done</button> : (
        <>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          {preview && (
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !toSave}>
              {busy ? <Spinner small /> : <CheckCircle2 />} Save {preview.add.length} new + {preview.update.length} updated
            </button>
          )}
        </>
      )}
    >
      <div className="stack">
        {!done && (
          <div className="card card-pad" style={{ background: 'var(--ink-50)' }}>
            <strong>3 steps</strong>
            <ol className="small mb-0" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
              <li>
                Download the Excel template:{' '}
                <a className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} href="/api/admin/existing-customers/template.xlsx" download><Download size={14} /> blank</a>
                {' '}or{' '}
                <a className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} href="/api/admin/existing-customers/template.xlsx?with=customers" download><Download size={14} /> with all current customers</a> (to correct details).
              </li>
              <li>Fill one customer per row in the <strong>Customers</strong> sheet - only <strong>mobile</strong> is required. The sheet <em>How to fill</em> explains every column; state is a dropdown.</li>
              <li>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy && !preview ? <Spinner small /> : <FileUp />} Upload the filled .xlsx</button>
                {fileName && <span className="small soft"> {fileName}</span>}
                <div className="tiny soft mt-1">Nothing is saved yet - you first see every row.</div>
              </li>
            </ol>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={pick} />
          </div>
        )}
        {error && <Alert type="error">{error.message}</Alert>}
        {view && (
          <>
            <div className="stat-grid">
              <div className="stat tone-success"><span className="stat-label">New customers</span><span className="stat-value">{view.add.length}</span></div>
              <div className="stat tone-info"><span className="stat-label">Details updated</span><span className="stat-value">{view.update.length}</span></div>
              <div className="stat"><span className="stat-label">No change</span><span className="stat-value">{view.unchanged.length}</span></div>
              <div className={`stat ${view.errors.length ? 'tone-danger' : ''}`}><span className="stat-label">Rows with a problem</span><span className="stat-value">{view.errors.length}</span></div>
            </div>
            {view.errors.length > 0 && (
              <>
                <Alert type="warning">{done ? 'These rows were skipped.' : 'These rows will be skipped'} - correct them in Excel (see the row number) and upload the file again. Rows already saved are not added twice.</Alert>
                <RowTable rows={view.errors} extra={{ label: 'Problem', value: (r) => r.reason }} />
              </>
            )}
            {view.add.length > 0 && <><h4 className="mb-0">New</h4><RowTable rows={view.add} /></>}
            {view.update.length > 0 && <><h4 className="mb-0">Updated</h4><RowTable rows={view.update} extra={{ label: 'Changes', value: (r) => (r.fields || []).map((f) => FIELD_LABEL[f] || f).join(', ') }} /></>}
            {!done && preview && !toSave && !view.errors.length && <Alert type="info">Nothing new in this file - every customer is already saved with these details.</Alert>}
          </>
        )}
      </div>
    </Modal>
  );
}
