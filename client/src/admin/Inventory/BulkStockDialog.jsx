import { useRef, useState } from 'react';
import { Download, FileUp, CheckCircle2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Spinner } from '../../components/common/ui.jsx';

// Bulk stock update with Excel: download the stock sheet, fill new_stock or
// add_stock, upload the CSV, check the preview, apply.
async function upload(text, apply) {
  const res = await fetch(`/api/admin/inventory/stock-sheet${apply ? '?apply=1' : ''}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'text/csv', 'X-Requested-With': 'NutexAdmin', Accept: 'application/json' },
    body: text,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message || 'Upload failed.'), { code: body?.error?.code });
  return body;
}

const SHOW = 300;

export function BulkStockDialog({ open, onClose, onApplied }) {
  const fileRef = useRef(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setText(''); setFileName(''); setPreview(null); setDone(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { reset(); onClose(); };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPreview(null); setDone(null); setError('');
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setError('Please upload a CSV file. In Excel: File → Save As → "CSV UTF-8 (Comma delimited)".');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const content = String(reader.result || '');
      setText(content);
      setFileName(f.name);
      setBusy(true);
      try {
        setPreview(await upload(content, false));
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(f);
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await upload(text, true);
      setDone(r);
      setPreview(null);
      onApplied?.(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Bulk stock update (Excel)"
      onClose={close}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn" onClick={close}>{done ? 'Close' : 'Cancel'}</button>
          {preview && preview.to_change > 0 && !done && (
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
              {busy ? <Spinner small /> : <CheckCircle2 />} Apply {preview.to_change} change{preview.to_change === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}
    >
      <div className="stack" style={{ gap: 14 }}>
        <ol className="bulk-steps">
          <li>
            <strong>Download the stock sheet</strong> - every product, colour and size with its current stock (pieces only).
            <div className="mt-1"><a className="btn btn-sm" href="/api/admin/inventory/stock-sheet" download><Download /> Download stock sheet</a></div>
          </li>
          <li>
            <strong>Fill it in Excel</strong> (only the rows that change; leave the rest blank):
            <ul className="small">
              <li><code>new_stock</code> = the stock you counted (replaces the current stock)</li>
              <li><code>add_stock</code> = new pieces / boxes received (added to the current stock)</li>
              <li>Stock is entered in <b>pieces only</b> - boxes are packed from the pieces automatically.</li>
              <li>Do not change the other columns. Save as <b>CSV UTF-8 (Comma delimited)</b>.</li>
            </ul>
          </li>
          <li>
            <strong>Upload the CSV</strong> - you will see every change first. Nothing is saved until you click Apply.
            <div className="mt-1">
              <label className="btn btn-sm">
                <FileUp /> {fileName || 'Choose CSV file'}
                <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" onChange={onFile} hidden />
              </label>
              {busy && <span className="ml-1"><Spinner small /></span>}
            </div>
          </li>
        </ol>

        {error && <Alert type="error">{error}</Alert>}

        {done && (
          <Alert type="success">
            Stock updated for {done.applied} item{done.applied === 1 ? '' : 's'}.
            {done.errors.length > 0 && ` ${done.errors.length} row(s) were skipped - see below.`}
          </Alert>
        )}

        {preview && (
          <>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge badge-brand">{preview.to_change} to change</span>
              <span className="badge badge-outline">{preview.unchanged} same as now</span>
              <span className="badge badge-outline">{preview.blank} blank rows</span>
              {preview.errors.length > 0 && <span className="badge badge-danger">{preview.errors.length} with problems (skipped)</span>}
            </div>
            {preview.to_change === 0 && <Alert type="info">Nothing to change. Fill new_stock or add_stock for the rows you want to update.</Alert>}
            {preview.changes.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 320 }}>
                <table className="table">
                  <thead><tr><th>Product</th><th>Item</th><th className="right">Now</th><th className="right">New</th></tr></thead>
                  <tbody>
                    {preview.changes.slice(0, SHOW).map((c) => (
                      <tr key={c.inventory_id}>
                        <td><div className="cell-main">{c.product_name}</div><div className="cell-sub">{c.product_sku}</div></td>
                        <td className="small">{c.type === 'BOX' ? 'Box' : c.colour} · {c.size}</td>
                        <td className="num">{c.from}</td>
                        <td className="num"><strong>{c.to}</strong>{c.mode === 'add' && <span className="cell-sub"> (+{c.to - c.from})</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.changes.length > SHOW && <p className="small muted">…and {preview.changes.length - SHOW} more.</p>}
              </div>
            )}
          </>
        )}

        {(preview?.errors?.length > 0 || done?.errors?.length > 0) && (
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table className="table">
              <thead><tr><th>Row</th><th>Item</th><th>Problem</th></tr></thead>
              <tbody>
                {(preview || done).errors.map((e) => (
                  <tr key={e.line}><td className="num">{e.line}</td><td className="small">{e.item || '—'}</td><td className="small">{e.message}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
