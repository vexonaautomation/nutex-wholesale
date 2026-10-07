import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { orderApi, saveOrderAccess } from '../../services/order.js';
import { Alert, Field, Spinner } from '../../components/common/ui.jsx';

/** Order number + mobile verification -> issues an access token for this device. */
export function VerifyOrderAccess({ initialOrderNumber = '', onVerified, title = 'Verify your order' }) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await orderApi.track(orderNumber.trim().toUpperCase(), mobile.trim());
      saveOrderAccess(res.order.order_number, res.access_token, { final_payable: res.order.totals.final_payable, business: res.order.customer.business_name });
      onVerified?.(res.order);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card card-pad stack" onSubmit={submit} style={{ maxWidth: 460 }}>
      <h2 className="card-title"><ShieldCheck /> {title}</h2>
      <p className="small muted mb-0">Enter your order number and the mobile number used while ordering.</p>
      <Field label="Order number" required>
        <input className="input" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="e.g. NX-20261003-0001" style={{ textTransform: 'uppercase' }} required />
      </Field>
      <Field label="Mobile number" required>
        <input className="input" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" placeholder="10-digit mobile" required />
      </Field>
      {error && <Alert type="error">{error.message}</Alert>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy && <Spinner small />} Find my order</button>
    </form>
  );
}
