import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QrCode, RotateCcw, Upload } from 'lucide-react';
import { adminApi, uploadImage } from '../services/auth.js';
import { useAsync } from '../hooks/index.js';
import { useToast } from '../context/ToastContext.jsx';
import { Modal } from '../components/common/Modal.jsx';
import { Alert, PageLoader, Spinner } from '../components/common/ui.jsx';
import { MAX_UPLOAD_BYTES } from '../utils/image.js';

/**
 * Payment QR management. The QR is uploaded EXACTLY as provided (no
 * compression) to Google Drive / PAYMENT and becomes live immediately.
 * Older QR files stay in Drive; every change is in the audit log.
 */
export function PaymentQrManager({ onSaved }) {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => adminApi.get('/settings'), []);
  const [pending, setPending] = useState(null); // { file_id, preview_url }
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  if (loading && !data) return <PageLoader />;
  const s = data?.settings || {};
  const hasQr = Boolean(s.payment_qr_file_id);
  const currentSrc = hasQr ? `/api/admin/media/${encodeURIComponent(s.payment_qr_file_id)}` : s.payment_qr_demo_url;

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast.error('Upload the QR as a PNG, JPG or WEBP image.');
    if (f.size > MAX_UPLOAD_BYTES) return toast.error('Image is too large (max 8 MB).');
    setBusy(true);
    try {
      const res = await uploadImage(f, 'qr'); // exact file - never compressed
      setPending({ file_id: res.file_id, preview_url: res.preview_url });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (fileId, message) => {
    setBusy(true);
    try {
      await adminApi.put('/settings', { payment_qr_file_id: fileId });
      toast.success(message);
      setPending(null);
      await reload();
      onSaved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qr-manager">
      <div className="qr-manager-grid">
        <div>
          <div className="small muted mb-1">{pending ? 'New QR (not live yet)' : hasQr ? 'Current payment QR (live)' : 'No QR uploaded - customers see the DEMO QR'}</div>
          <div className="qr-manager-preview">
            <img src={pending ? pending.preview_url : currentSrc} alt="Payment QR" />
            {!pending && !hasQr && <span className="qr-demo-ribbon">DEMO QR</span>}
          </div>
        </div>
        <div className="stack">
          {pending ? (
            <>
              <Alert type="warning">Check the new QR carefully: scan it with your own UPI app and confirm the payee name before making it live.</Alert>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(pending.file_id, 'New payment QR is live.')}>{busy && <Spinner small />} Make this QR live</button>
              <button type="button" className="btn" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
            </>
          ) : (
            <>
              <span className={`badge ${hasQr ? 'badge-success' : 'badge-warning'}`} style={{ alignSelf: 'flex-start' }}>{hasQr ? 'Live QR' : 'Demo QR showing'}</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                {busy ? <Spinner small /> : <Upload />} {hasQr ? 'Upload new QR' : 'Upload payment QR'}
              </button>
              {hasQr && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => window.confirm('Remove the live QR? Customers will see the DEMO QR and will not be able to pay until a new QR is uploaded.') && save('', 'QR removed - demo QR is showing.')}
                >
                  <RotateCcw /> Remove QR (show demo)
                </button>
              )}
              <dl className="kv small mt-1">
                <dt>UPI ID</dt><dd>{s.upi_id || <span className="soft">not set</span>}</dd>
                <dt>Payee name</dt><dd>{s.payment_name || <span className="soft">not set</span>}</dd>
              </dl>
              <Link to="/admin/settings" className="link small">Edit UPI ID, payee name and instructions in Settings → Payment</Link>
            </>
          )}
          <p className="tiny soft mb-0">The image is uploaded exactly as-is to Google Drive (PAYMENT folder). Old QR files are kept and every change is recorded in the audit log.</p>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} />
    </div>
  );
}

export function PaymentQrButton({ className = 'btn', label = 'Update payment QR', onSaved }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><QrCode /> {label}</button>
      <Modal open={open} title="Payment QR" onClose={() => setOpen(false)} size="lg">
        <PaymentQrManager onSaved={onSaved} />
      </Modal>
    </>
  );
}
