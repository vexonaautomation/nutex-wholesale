import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, FileImage, Lock, Upload, Info } from 'lucide-react';
import { orderApi, getOrderToken, newIdempotencyKey } from '../../services/order.js';
import { useStore } from '../../context/StoreContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { PaymentQR } from '../../components/PaymentQR/PaymentQR.jsx';
import { OrderItems } from '../../components/OrderSummary/OrderSummary.jsx';
import { Alert, ErrorState, Field, PageLoader, Spinner, StatusBadge } from '../../components/common/ui.jsx';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { VerifyOrderAccess } from '../TrackOrder/VerifyOrderAccess.jsx';
import { DownloadBillButton } from '../../components/DownloadBill/DownloadBillButton.jsx';
import { formatINR } from '../../utils/format.js';
import { compressImage, MAX_UPLOAD_BYTES } from '../../utils/image.js';
import { paymentConfirmationMessage, waLink, waNumber } from '../../utils/whatsapp.js';

export default function Payment() {
  const { orderNumber } = useParams();
  const { settings } = useStore();
  const [state, setState] = useState({ loading: true, order: null, error: null });
  const [form, setForm] = useState({ amount: '', utr: '', customer_note: '' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const fileRef = useRef(null);
  const idemKey = useMemo(() => newIdempotencyKey('pay'), []);
  useSeo({ title: `Payment for ${orderNumber} | Nutex Wholesale`, noindex: true });

  const load = async () => {
    if (!getOrderToken(orderNumber)) {
      setState({ loading: false, order: null, error: { code: 'ORDER_ACCESS_REQUIRED' } });
      return;
    }
    try {
      const { order } = await orderApi.get(orderNumber);
      setState({ loading: false, order, error: null });
      setForm((f) => ({ ...f, amount: f.amount || String(order.amount_to_pay || '') }));
    } catch (error) {
      setState({ loading: false, order: null, error });
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  if (state.loading) return <PageLoader />;
  if (state.error?.code === 'ORDER_ACCESS_REQUIRED') {
    return <div className="container page"><VerifyOrderAccess initialOrderNumber={orderNumber} onVerified={() => { setState({ loading: true }); load(); }} /></div>;
  }
  if (state.error) return <div className="container page"><ErrorState error={state.error} onRetry={load} /></div>;

  const { order } = state;
  const wa = waNumber(settings, 'payment');
  const latest = submitted || order.payments.filter((p) => p.status !== 'REJECTED').slice(-1)[0];
  const message = paymentConfirmationMessage({
    orderNumber: order.order_number,
    amount: latest?.amount ?? order.amount_to_pay,
    utr: latest?.utr,
    businessName: order.customer.business_name,
  });

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) {
      setSubmitError({ message: 'Upload the screenshot as JPG, PNG, WEBP or PDF.' });
      return;
    }
    const ready = f.type.startsWith('image/') ? await compressImage(f, { maxDim: 2000, quality: 0.88, minBytes: 1.5 * 1024 * 1024 }) : f;
    if (ready.size > MAX_UPLOAD_BYTES) {
      setSubmitError({ message: 'File is too large (maximum 8 MB).' });
      return;
    }
    setSubmitError(null);
    setFile(ready);
    setPreview(ready.type.startsWith('image/') ? URL.createObjectURL(ready) : '');
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    if (!(Number(form.amount) > 0)) return setSubmitError({ message: 'Enter the amount you paid.' });
    if (form.utr.trim() && !/^[A-Za-z0-9]{6,30}$/.test(form.utr.trim())) return setSubmitError({ message: 'Enter a valid UTR / Transaction ID (6-30 letters or digits), or leave it blank.' });
    if (!file) return setSubmitError({ message: 'Please attach the payment screenshot.' });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('amount', String(form.amount));
      fd.set('utr', form.utr.trim());
      fd.set('customer_note', form.customer_note);
      fd.set('idempotency_key', idemKey);
      fd.set('screenshot', file, file.name);
      const res = await orderApi.submitPayment(order.order_number, fd);
      setSubmitted({ amount: Number(form.amount), utr: form.utr.trim().toUpperCase() });
      setState({ loading: false, order: res.order, error: null });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitError(err);
      if (['PAYMENT_ALREADY_SUBMITTED', 'ORDER_LOCKED'].includes(err.code)) load();
    } finally {
      setBusy(false);
    }
  };

  const canPay = order.permissions.can_submit_payment;
  const awaitingVerification = order.locked && order.payment_status === 'SUBMITTED';

  return (
    <div className="container page">
      <div className="step-list">
        <span className="step-pill done"><i>1</i> Cart</span><span className="step-sep" />
        <span className="step-pill done"><i>2</i> Details</span><span className="step-sep" />
        <span className={`step-pill ${canPay ? 'on' : 'done'}`}><i>3</i> Payment</span>
      </div>
      <div className="order-head">
        <div>
          <span className="eyebrow">Order</span>
          <h1 className="order-no">{order.order_number}</h1>
          <div className="row wrap mt-1"><StatusBadge status={order.order_status} /><StatusBadge kind="payment" status={order.payment_status} /></div>
        </div>
        <Link to={`/order/${order.order_number}`} className="btn btn-sm">View order details</Link>
      </div>

      {(awaitingVerification || submitted) && (
        <div className="success-hero mb-3">
          <div className="icon"><CheckCircle2 size={30} /></div>
          <h2 className="display" style={{ fontSize: 26 }}>Payment details submitted</h2>
          <p className="muted" style={{ maxWidth: 560, margin: '0 auto 14px' }}>
            Your order has been locked because payment confirmation has been submitted. Our team will verify the payment and update your order status.
          </p>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 10 }}>
            {wa && (
              <a className="btn btn-whatsapp btn-lg" href={waLink(wa, message)} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> Confirm Payment on WhatsApp</a>
            )}
            {order.permissions.can_download_bill && <DownloadBillButton orderNumber={order.order_number} className="btn btn-lg" />}
          </div>
          <p className="tiny soft mt-2 mb-0">Sending a WhatsApp message does not verify the payment - verification is done by the Nutex team.</p>
        </div>
      )}

      {!canPay && !awaitingVerification && !submitted && (
        <Alert type={order.order_status === 'CANCELLED' ? 'error' : 'info'} className="mb-3">
          {order.order_status === 'CANCELLED'
            ? 'This order has been cancelled and cannot be paid.'
            : order.payment_status === 'VERIFIED' ? 'Payment for this order has been verified. Thank you!' : 'No payment is due for this order right now.'}
        </Alert>
      )}

      {canPay && (
        <div className="two-col">
          <div className="stack" style={{ gap: 18 }}>
            {order.order_status === 'PAYMENT_REJECTED' && (
              <Alert type="error">
                Your previous payment could not be verified{order.payments.slice(-1)[0]?.remarks ? `: ${order.payments.slice(-1)[0].remarks}` : '.'} Please submit the correct payment details.
              </Alert>
            )}
            <section className="card card-pad">
              <h2 className="card-title">Step 1 · Pay using the QR code</h2>
              <PaymentQR settings={settings} amount={order.amount_to_pay} orderNumber={order.order_number} />
              {settings?.payment_instructions && (
                <div className="info-tile mt-2"><Info /><div style={{ whiteSpace: 'pre-line' }}>{settings.payment_instructions}</div></div>
              )}
              {order.payment_window_hours && (
                <p className="small muted mt-2 mb-0">Please complete payment within {order.payment_window_hours} hours - unpaid orders are cancelled automatically and the stock is released.</p>
              )}
            </section>

            <form className="card card-pad" onSubmit={submit} noValidate>
              <h2 className="card-title">Step 2 · Submit payment details</h2>
              <div className="form-grid">
                <Field label="Order number"><input className="input" value={order.order_number} disabled /></Field>
                <Field label="Payment amount (₹)" required hint={`Amount due: ${formatINR(order.amount_to_pay)}`}>
                  <input className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} />
                </Field>
                <Field label="UTR / Transaction ID (optional)" hint="12-digit UPI reference number from your payment app - you can leave it blank" className="span-2">
                  <input className="input" value={form.utr} onChange={(e) => setForm({ ...form, utr: e.target.value.replace(/\s/g, '') })} maxLength={30} style={{ textTransform: 'uppercase' }} />
                </Field>
                <div className="span-2">
                  <span className="field-label">Payment screenshot <span className="req">*</span></span>
                  <label className="file-drop mt-1">
                    {preview ? <img src={preview} alt="Payment screenshot preview" /> : <span className="file-drop-icon">{file ? <FileImage /> : <Upload />}</span>}
                    <span>
                      <strong>{file ? file.name : 'Upload screenshot'}</strong>
                      <span className="small muted" style={{ display: 'block' }}>JPG, PNG, WEBP or PDF · max 8 MB</span>
                    </span>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onFile} className="sr-only" />
                  </label>
                </div>
                <Field label="Note (optional)" className="span-2"><input className="input" value={form.customer_note} onChange={(e) => setForm({ ...form, customer_note: e.target.value })} maxLength={500} /></Field>
              </div>
              {submitError && <Alert type="error" className="mt-2">{submitError.message}</Alert>}
              <div className="alert alert-warning mt-2"><Lock /> After you submit, your order is <strong>locked</strong> and can no longer be edited.</div>
              <button type="submit" className="btn btn-primary btn-lg btn-block mt-2" disabled={busy}>{busy && <Spinner small />} Submit payment</button>
            </form>
          </div>
          <aside className="sticky-col stack">
            <div className="card card-pad">
              <h3 className="card-title">Order summary</h3>
              <OrderItems items={order.items} />
              <div className="summary-total"><span>Amount to pay</span><strong>{formatINR(order.amount_to_pay)}</strong></div>
            </div>
            {order.permissions.can_edit && (
              <Link to={`/order/${order.order_number}`} className="btn btn-block">Need changes? Edit order before paying</Link>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
