import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { useCart } from '../../context/CartContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { orderApi, saveOrderAccess, newIdempotencyKey } from '../../services/order.js';
import { CartSummary } from '../../components/CartSummary/CartSummary.jsx';
import { MinimumOrderProgress } from '../../components/MinimumOrderProgress/MinimumOrderProgress.jsx';
import { Alert, Field, Messages, PageLoader, Spinner } from '../../components/common/ui.jsx';
import { formatINR, pct } from '../../utils/format.js';
import { INDIAN_STATES } from '../../constants/index.js';
import { useCustomer } from '../../context/CustomerContext.jsx';

const SAVED_KEY = 'nutex_customer_v1';
const IDEM_KEY = 'nutex_checkout_key';
const EMPTY = {
  customer_name: '', business_name: '', mobile: '', whatsapp: '', alternate_mobile: '', email: '', billing_address: '', shipping_address: '',
  same_as_billing: true, city: '', state: '', pincode: '', gstin: '', order_notes: '',
};

function loadSaved() {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}), order_notes: '' };
  } catch {
    return EMPTY;
  }
}

function validate(f) {
  const e = {};
  const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (f.customer_name.trim().length < 2) e.customer_name = 'Enter your name';
  if (f.business_name.trim().length < 2) e.business_name = 'Enter your business / shop name';
  if (!/^[6-9]\d{9}$/.test(digits(f.mobile))) e.mobile = 'Enter a valid 10-digit mobile number';
  if (f.whatsapp && !/^[6-9]\d{9}$/.test(digits(f.whatsapp))) e.whatsapp = 'Enter a valid 10-digit WhatsApp number';
  if (f.alternate_mobile && !/^[6-9]\d{9}$/.test(digits(f.alternate_mobile))) e.alternate_mobile = 'Enter a valid 10-digit alternate number';
  else if (f.alternate_mobile && digits(f.alternate_mobile) === digits(f.mobile)) e.alternate_mobile = 'Must be different from the main mobile number';
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) e.email = 'Enter a valid email';
  if (f.billing_address.trim().length < 5) e.billing_address = 'Enter the billing address';
  if (!f.same_as_billing && f.shipping_address.trim().length < 5) e.shipping_address = 'Enter the shipping address';
  if (f.city.trim().length < 2) e.city = 'Enter city';
  if (!f.state) e.state = 'Select state';
  if (!/^[1-9]\d{5}$/.test(f.pincode.trim())) e.pincode = 'Enter a valid 6-digit pincode';
  if (f.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.trim().toUpperCase())) e.gstin = 'Enter a valid 15-character GSTIN';
  return e;
}

export default function Checkout() {
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(loadSaved);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const { quote } = cart;
  const customer = useCustomer();
  const verifiedMobile = customer.auth?.mobile || '';
  useSeo({ title: 'Checkout | Nutex Wholesale', noindex: true });

  // The minimum-order exemption is tied to the WhatsApp-verified number.
  useEffect(() => {
    if (verifiedMobile) setForm((f) => (f.mobile === verifiedMobile ? f : { ...f, mobile: verifiedMobile }));
  }, [verifiedMobile]);

  // One idempotency key per checkout attempt: double-clicks / refreshes never create two orders.
  const idemKey = useMemo(() => {
    let k = sessionStorage.getItem(IDEM_KEY);
    if (!k) {
      k = newIdempotencyKey('checkout');
      sessionStorage.setItem(IDEM_KEY, k);
    }
    return k;
  }, []);

  useEffect(() => {
    if (quote && !quote.can_checkout) setServerError(null);
  }, [quote]);

  if (cart.editing) return <Navigate to="/cart" replace />;
  if (!cart.items.length) return <Navigate to="/cart" replace />;
  if (!quote) return <PageLoader label="Preparing checkout…" />;

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) {
      toast.error('Please complete the highlighted fields.');
      return;
    }
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await orderApi.createDraft({
        customer: { ...form, gstin: form.gstin.trim().toUpperCase() },
        items: cart.items.map(({ variant_id, qty }) => ({ variant_id, qty })),
        idempotency_key: idemKey,
        client_final_payable: quote.final_payable,
      });
      saveOrderAccess(res.order_number, res.access_token, { final_payable: res.order?.totals?.final_payable, business: form.business_name });
      try {
        const { order_notes: _n, ...remember } = form;
        localStorage.setItem(SAVED_KEY, JSON.stringify(remember));
      } catch { /* ignore */ }
      sessionStorage.removeItem(IDEM_KEY);
      cart.clear();
      toast.success(`Order ${res.order_number} created. Please complete the payment.`);
      navigate(`/order/${res.order_number}/payment`, { replace: true });
    } catch (err) {
      setServerError(err);
      if (Array.isArray(err.details)) {
        const fieldErrors = {};
        for (const d of err.details) if (d.path?.startsWith('customer.')) fieldErrors[d.path.slice(9)] = d.message;
        setErrors((x) => ({ ...x, ...fieldErrors }));
      }
      if (['STOCK_CHANGED', 'PRICE_CHANGED', 'MIN_ORDER_NOT_MET'].includes(err.code)) {
        sessionStorage.removeItem(IDEM_KEY);
        cart.refreshQuote();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container page">
      <div className="step-list">
        <span className="step-pill done"><i>1</i> Cart</span><span className="step-sep" />
        <span className="step-pill on"><i>2</i> Details</span><span className="step-sep" />
        <span className="step-pill"><i>3</i> Payment</span>
      </div>
      <h1 className="page-title">Checkout</h1>
      <form className="two-col mt-2" onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 18 }}>
          <section className="card card-pad">
            <h2 className="card-title">Business &amp; contact details</h2>
            <div className="form-grid">
              <Field label="Customer name" required error={errors.customer_name}><input className="input" value={form.customer_name} onChange={set('customer_name')} autoComplete="name" aria-invalid={!!errors.customer_name} /></Field>
              <Field label="Business / shop name" required error={errors.business_name}><input className="input" value={form.business_name} onChange={set('business_name')} autoComplete="organization" aria-invalid={!!errors.business_name} /></Field>
              <Field
                label="Mobile number"
                required
                error={errors.mobile}
                hint={verifiedMobile ? (
                  <>
                    Verified existing customer ✓ ·{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        if (window.confirm('Use a different number? The existing-customer exemption (no minimum) will be removed for this order.')) {
                          customer.logout();
                          setForm((f) => ({ ...f, mobile: '' }));
                        }
                      }}
                    >
                      use a different number
                    </button>
                  </>
                ) : undefined}
              >
                <input className="input" value={form.mobile} onChange={set('mobile')} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" aria-invalid={!!errors.mobile} readOnly={!!verifiedMobile} style={verifiedMobile ? { background: '#f3fbf6' } : undefined} />
              </Field>
              <Field label="WhatsApp number" hint="Leave blank if same as mobile" error={errors.whatsapp}><input className="input" value={form.whatsapp} onChange={set('whatsapp')} inputMode="tel" aria-invalid={!!errors.whatsapp} /></Field>
              <Field label="Alternate mobile (optional)" hint="Another number you use - it can also be used later to log in as an existing customer" error={errors.alternate_mobile} className="span-2"><input className="input" value={form.alternate_mobile} onChange={set('alternate_mobile')} inputMode="tel" placeholder="Second mobile / WhatsApp number" aria-invalid={!!errors.alternate_mobile} /></Field>
              <Field label="Email (optional)" error={errors.email} className="span-2"><input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" aria-invalid={!!errors.email} /></Field>
              <Field label="GST number (optional)" hint="For a GST invoice" error={errors.gstin} className="span-2"><input className="input" value={form.gstin} onChange={set('gstin')} style={{ textTransform: 'uppercase' }} maxLength={15} aria-invalid={!!errors.gstin} /></Field>
            </div>
          </section>
          <section className="card card-pad">
            <h2 className="card-title">Address</h2>
            <div className="form-grid">
              <Field label="Billing address" required error={errors.billing_address} className="span-2"><textarea className="textarea" value={form.billing_address} onChange={set('billing_address')} autoComplete="street-address" aria-invalid={!!errors.billing_address} /></Field>
              <label className="check span-2"><input type="checkbox" checked={form.same_as_billing} onChange={set('same_as_billing')} /> Shipping address is the same as billing</label>
              {!form.same_as_billing && (
                <Field label="Shipping address" required error={errors.shipping_address} className="span-2"><textarea className="textarea" value={form.shipping_address} onChange={set('shipping_address')} aria-invalid={!!errors.shipping_address} /></Field>
              )}
              <Field label="City" required error={errors.city}><input className="input" value={form.city} onChange={set('city')} autoComplete="address-level2" aria-invalid={!!errors.city} /></Field>
              <Field label="State" required error={errors.state}>
                <select className="select" value={form.state} onChange={set('state')} aria-invalid={!!errors.state}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Pincode" required error={errors.pincode}><input className="input" value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} autoComplete="postal-code" aria-invalid={!!errors.pincode} /></Field>
              <Field label="Order notes (optional)" className="span-2"><textarea className="textarea" value={form.order_notes} onChange={set('order_notes')} maxLength={1000} placeholder="Packing or delivery instructions" /></Field>
            </div>
          </section>
          <section className="card card-pad">
            <h2 className="card-title">Review your order</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Product</th><th>Variant</th><th className="right">Qty</th><th className="right">MRP</th><th className="right">Disc.</th><th className="right">Price</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {quote.lines.map((l) => (
                    <tr key={l.key}>
                      <td><div style={{ fontWeight: 600 }}>{l.product_name}</div><div className="tiny soft">{l.sku}</div>{l.issue && <div className="field-error">{l.issue.message}</div>}</td>
                      <td className="small">{[l.color_name, l.size_name && `Size ${l.size_name}`, l.box_label].filter(Boolean).join(' · ')}</td>
                      <td className="right num">{l.qty}</td>
                      <td className="right num">{formatINR(l.unit_mrp)}</td>
                      <td className="right num">{l.discount_percent !== null ? pct(l.discount_percent) : '—'}</td>
                      <td className="right num">{formatINR(l.unit_price)}</td>
                      <td className="right num"><strong>{formatINR(l.line_total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link to="/cart" className="link small mt-2" style={{ display: 'inline-block' }}>Edit cart</Link>
          </section>
        </div>

        <aside className="sticky-col stack">
          <div className="card card-pad"><CartSummary quote={quote} /></div>
          <MinimumOrderProgress quote={quote} />
          <Messages messages={quote.messages.filter((m) => m.type !== 'success')} />
          {serverError && (
            <Alert type="error">
              {serverError.message}
              {['STOCK_CHANGED', 'PRICE_CHANGED'].includes(serverError.code) && <> <Link to="/cart" className="link">Review cart</Link></>}
            </Alert>
          )}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!quote.can_checkout || submitting || cart.quoting}>
            {submitting ? <Spinner small /> : <Lock />} Place order · {formatINR(quote.final_payable)}
          </button>
          <div className="info-tile"><ShieldCheck /> Your order number is created now. You can still edit the order until you submit payment confirmation.</div>
        </aside>
      </form>
    </div>
  );
}
