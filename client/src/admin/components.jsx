import { useRef, useState } from 'react';
import { ImagePlus, Search, Trash2, Upload } from 'lucide-react';
import { Modal } from '../components/common/Modal.jsx';
import { Alert, Field, Spinner } from '../components/common/ui.jsx';
import { uploadImage } from '../services/auth.js';
import { compressImage, MAX_UPLOAD_BYTES } from '../utils/image.js';
import { useToast } from '../context/ToastContext.jsx';

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="adm-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="adm-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, icon: Icon, tone, to, onClick }) {
  const body = (
    <>
      <span className="stat-label">{Icon && <Icon />}{label}</span>
      <span className="stat-value">{value}</span>
    </>
  );
  if (to) return <a href={to} className={`stat tone-${tone || 'default'}`} onClick={onClick}>{body}</a>;
  return <div className={`stat tone-${tone || 'default'}`}>{body}</div>;
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="search">
      <Search />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

/** Confirmation dialog with optional required reason (used for reopen/cancel/reject). */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, reasonLabel, reasonRequired, onConfirm, onClose, children }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    if (reasonRequired && reason.trim().length < 5) {
      setError({ message: `${reasonLabel || 'Reason'} must be at least 5 characters.` });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
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
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={submit} disabled={busy}>{busy && <Spinner small />}{confirmLabel}</button>
        </>
      )}
    >
      <div className="stack">
        {message && <p className="mb-0">{message}</p>}
        {children}
        {reasonLabel && (
          <Field label={reasonLabel} required={reasonRequired}>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
          </Field>
        )}
        {error && <Alert type="error">{error.message}</Alert>}
      </div>
    </Modal>
  );
}

/** Uploads one image to Google Drive (through the API) and returns its file id. */
export function SingleImageUpload({ value, previewUrl, purpose, onChange, label = 'Image', exact = false, hint }) {
  const ref = useRef(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState('');
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast.error('Only JPG, PNG or WEBP images are allowed.');
    const file = exact ? f : await compressImage(f);
    if (file.size > MAX_UPLOAD_BYTES) return toast.error('Image is too large (max 8 MB).');
    setBusy(true);
    try {
      const res = await uploadImage(file, purpose);
      setLocalPreview(res.preview_url);
      onChange(res.file_id, res);
      toast.success('Image uploaded to Google Drive.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  const shown = localPreview || (value ? previewUrl || `/api/admin/media/${encodeURIComponent(value)}` : '');
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="single-upload">
        <div className="preview">{shown ? <img src={shown} alt="" /> : <ImagePlus color="var(--ink-400)" />}</div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => ref.current?.click()} disabled={busy}>{busy ? <Spinner small /> : <Upload />} {value ? 'Replace' : 'Upload'}</button>
            {value && <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setLocalPreview(''); onChange(''); }}><Trash2 /> Remove</button>}
          </div>
          {hint && <span className="field-hint">{hint}</span>}
        </div>
        <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} />
      </div>
    </div>
  );
}

export function Pager({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="row mt-2" style={{ justifyContent: 'flex-end' }}>
      <span className="small muted">Page {page} of {pages} · {total} records</span>
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
