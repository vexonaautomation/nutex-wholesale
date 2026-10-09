import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp } from 'lucide-react';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Spinner } from '../../components/common/ui.jsx';

// Bulk product edit with Excel: download the pre-filled .xlsx, edit it,
// upload it, check the preview, apply.
async function upload(buffer, apply) {
  const res = await fetch(`/api/admin/products/bulk-edit${apply ? '?apply=1' : ''}`, {
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

const SHOW = 200;
const Chips = ({ items, sign, tone }) => (items?.length ? <span className={`badge ${tone}`}>{sign} {items.join(', ')}</span> : null);

export function BulkEditDialog({ open, selectedIds = [], total = 0, onClose, onApplied }) {
  const fileRef = useRef(null);
  const [buffer, setBuffer] = useState(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setBuffer(null); setFileName(''); setPreview(null); setDone(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => { reset(); onClose(); };
  const downloadUrl = `/api/admin/products/bulk-edit.xlsx${selectedIds.length ? `?ids=${encodeURIComponent(selectedIds.join(','))}` : ''}`;

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPreview(null); setDone(null); setError('');
    if (!/\.xlsx$/i.test(f.name)) { setError('Please upload the .xlsx file (in Excel: File → Save, keep the .xlsx format).'); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setBuffer(reader.result);
      setFileName(f.name);
      setBusy(true);
      try {
        setPreview(await upload(reader.result, false));
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await upload(buffer, true);
      setDone(r);
      setPreview(null);
      onApplied?.(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const view = done || preview;
  const changesCount = preview ? preview.products.to_change + (preview.stock?.to_change || 0) + (preview.stock?.pending?.length || 0) : 0;

  return (
    <Modal
      open={open}
      title="Bulk edit products (Excel)"
      onClose={close}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn" onClick={close}>{done ? 'Close' : 'Cancel'}</button>
          {preview && changesCount > 0 && !done && (
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
              {busy ? <Spinner small /> : <CheckCircle2 />} Apply changes
            </button>
          )}
        </>
      )}
    >
      <div className="stack" style={{ gap: 14 }}>
        <ol className="bulk-steps">
          <li>
            <strong>Download the Excel file</strong> - {selectedIds.length ? `the ${selectedIds.length} ticked product(s)` : `all ${total} products`}, pre-filled.
            <div className="mt-1"><a className="btn btn-sm" href={downloadUrl} download><Download /> Download Excel</a></div>
          </li>
          <li>
            <strong>Edit in Excel</strong>
            <ul className="small">
              <li><b>Products</b> tab: SKU, name, category, MRP, own discount %, pieces per box, loose pcs for new customers, status, featured.</li>
              <li><b>sizes</b> / <b>colours</b>: comma separated - delete one to remove it, type one to add it (names from the Lists tab).</li>
              <li><b>Stock</b> tab (optional): <code>new_stock</code> = counted, <code>add_stock</code> = received. For a new size, add a row with product_id, colour, size and new_stock.</li>
              <li>Do not change <code>product_id</code>. Save as <b>.xlsx</b>.</li>
            </ul>
          </li>
          <li>
            <strong>Upload</strong> - you see every change first; nothing is saved until you click Apply.
            <div className="mt-1">
              <label className="btn btn-sm">
                <FileUp /> {fileName || 'Choose Excel file'}
                <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} hidden />
              </label>
              {busy && <span className="ml-1"><Spinner small /></span>}
            </div>
          </li>
        </ol>

        {error && <Alert type="error">{error}</Alert>}
        {done && (
          <Alert type="success">
            Saved: {done.products.applied} product(s) updated{done.stock ? `, stock updated for ${done.stock.applied} item(s)` : ''}.
            {(done.products.errors.length + (done.stock?.errors?.length || 0)) > 0 && ' Some rows were skipped - see below.'}
          </Alert>
        )}

        {view && (
          <>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge badge-brand">{view.products.to_change} product(s) to change</span>
              <span className="badge badge-outline">{view.products.unchanged} unchanged</span>
              {view.stock && <span className="badge badge-brand">{view.stock.to_change} stock change(s)</span>}
              {view.stock?.pending?.length > 0 && <span className="badge badge-gold">{view.stock.pending.length} stock row(s) for new sizes/colours</span>}
              {(view.products.errors.length + (view.stock?.errors?.length || 0)) > 0 && <span className="badge badge-danger">{view.products.errors.length + (view.stock?.errors?.length || 0)} with problems (skipped)</span>}
            </div>
            {preview && changesCount === 0 && <Alert type="info">Nothing to change - edit the Excel file and upload it again.</Alert>}

            {view.products.changes?.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: 340 }}>
                <table className="table">
                  <thead><tr><th>Product</th><th>Changes</th></tr></thead>
                  <tbody>
                    {view.products.changes.slice(0, SHOW).map((c) => (
                      <tr key={c.product_id}>
                        <td><div className="cell-main">{c.name}</div><div className="cell-sub">{c.sku}</div></td>
                        <td className="small">
                          <div className="row wrap" style={{ gap: 6 }}>
                            <Chips items={c.sizes_added} sign="+ size" tone="badge-success" />
                            <Chips items={c.sizes_removed} sign="− size" tone="badge-danger" />
                            <Chips items={c.colours_added} sign="+ colour" tone="badge-success" />
                            <Chips items={c.colours_removed} sign="− colour" tone="badge-danger" />
                          </div>
                          {c.changes.map((x) => <div key={x.field}>{x.field}: <span className="muted">{x.from}</span> → <strong>{x.to}</strong></div>)}
                          {c.warnings?.map((w) => <div key={w} className="field-error">{w}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {view.products.changes.length > SHOW && <p className="small muted">…and {view.products.changes.length - SHOW} more.</p>}
              </div>
            )}

            {(view.products.errors.length > 0 || view.stock?.errors?.length > 0) && (
              <div className="table-wrap" style={{ maxHeight: 220 }}>
                <table className="table">
                  <thead><tr><th>Tab · row</th><th>Item</th><th>Problem</th></tr></thead>
                  <tbody>
                    {view.products.errors.map((e) => <tr key={`p${e.line}`}><td className="num">Products · {e.line}</td><td className="small">{e.sku || '—'}</td><td className="small">{e.message}</td></tr>)}
                    {(view.stock?.errors || []).map((e) => <tr key={`s${e.line}`}><td className="num">Stock · {e.line}</td><td className="small">{e.item || '—'}</td><td className="small">{e.message}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <p className="tiny soft mb-0">Removed sizes and colours are switched off, never deleted - their stock and old orders stay. Images and descriptions are not changed. New products are added with “Add product”.</p>
      </div>
    </Modal>
  );
}
