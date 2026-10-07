import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, LogOut, ShieldCheck, UserX } from 'lucide-react';
import { Modal } from '../common/Modal.jsx';
import { Alert, Field, Spinner } from '../common/ui.jsx';
import { WhatsAppIcon } from '../common/Icons.jsx';
import { customerApi } from '../../services/customer.js';
import { useCustomer } from '../../context/CustomerContext.jsx';
import { useStore } from '../../context/StoreContext.jsx';
import { formatINR, formatDate } from '../../utils/format.js';
import { waLink, waNumber } from '../../utils/whatsapp.js';

const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '').slice(0, 10);

/**
 * "Existing customer? Login" - mobile number -> WhatsApp OTP -> verified.
 * Works from anywhere on the site, before anything is added to the cart.
 */
export function ExistingCustomerLogin({ open, onClose }) {
  const { auth, login, logout, setNumbers } = useCustomer();
  const { settings } = useStore();
  const [step, setStep] = useState('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [wait, setWait] = useState(0);
  const [altMobile, setAltMobile] = useState('');
  const [altOtp, setAltOtp] = useState('');
  const [notice, setNotice] = useState('');
  const otpRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep(auth ? 'done' : 'mobile');
    setOtp('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (step === 'otp' || step === 'alt-otp') setTimeout(() => otpRef.current?.focus(), 50);
  }, [step]);

  const minText = (min) => (Number(min) > 0 ? `Your minimum order is ${formatINR(min)}.` : 'No minimum order value applies to you.');

  const send = async (e) => {
    e?.preventDefault();
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setError({ message: 'Enter your 10-digit mobile number.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await customerApi.start(mobile);
      setInfo(res);
      if (!res.existing) setStep('not-found');
      else if (res.verified) {
        login(res);
        setStep('done');
      } else {
        setStep('otp');
        setWait(res.resend_after || 60);
      }
    } catch (err) {
      if (err.details?.retry_after) setWait(err.details.retry_after);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError({ message: 'Enter the 6-digit code from WhatsApp.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await customerApi.confirm(mobile, otp);
      setNotice('');
      login(res);
      setStep('done');
    } catch (err) {
      setError(err);
      if (['OTP_EXPIRED', 'OTP_LOCKED'].includes(err.code)) setOtp('');
    } finally {
      setBusy(false);
    }
  };

  const sendAlt = async (e) => {
    e?.preventDefault();
    if (!/^[6-9]\d{9}$/.test(altMobile)) {
      setError({ message: 'Enter the other 10-digit mobile number.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await customerApi.alternateStart(altMobile);
      if (res.added) {
        setNumbers(res.numbers_masked);
        setNotice('Number added. You can now log in with it too.');
        setStep('done');
      } else {
        setInfo(res);
        setAltOtp('');
        setWait(res.resend_after || 60);
        setStep('alt-otp');
      }
    } catch (err) {
      if (err.details?.retry_after) setWait(err.details.retry_after);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmAlt = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(altOtp)) {
      setError({ message: 'Enter the 6-digit code from WhatsApp.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await customerApi.alternateConfirm(altMobile, altOtp);
      setNumbers(res.numbers_masked);
      setNotice(`+91 ${info?.mobile_masked} added. You can now log in with this number too.`);
      setAltMobile('');
      setStep('done');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const wa = waNumber(settings);
  const standardMin = settings ? formatINR(settings.minimum_order_value) : '';

  return (
    <Modal open={open} onClose={onClose} title="Existing customer login">
      {step === 'mobile' && (
        <form className="stack" onSubmit={send}>
          <p className="muted mb-0">
            Already buying from Nutex? Verify your registered mobile number and order <strong>any quantity</strong> - the {standardMin} minimum does not apply to existing customers.
          </p>
          <Field label="Registered mobile number" hint="Your main number or any alternate number you registered">
            <div className="input-prefix">
              <span>+91</span>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="tel-national"
                value={mobile}
                onChange={(e) => { setMobile(digits(e.target.value)); setError(null); }}
                placeholder="98765 43210"
                autoFocus
                style={{ paddingLeft: 44 }}
              />
            </div>
          </Field>
          {error && <Alert type="error">{error.message}</Alert>}
          <button type="submit" className="btn btn-whatsapp btn-lg btn-block" disabled={busy || wait > 0}>
            {busy ? <Spinner small /> : <WhatsAppIcon />} {wait > 0 ? `Try again in ${wait}s` : 'Send code on WhatsApp'}
          </button>
          <p className="tiny soft mb-0"><ShieldCheck size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> We send a one-time code to your WhatsApp. New customer? Just shop normally - no login needed.</p>
        </form>
      )}

      {step === 'otp' && (
        <form className="stack" onSubmit={confirm}>
          <p className="mb-0">Enter the 6-digit code sent on WhatsApp to <strong>+91 {info?.mobile_masked}</strong>.</p>
          {info?.dev_otp && <Alert type="warning">Development mode (no WhatsApp account configured): your code is <strong>{info.dev_otp}</strong></Alert>}
          <Field label="WhatsApp code">
            <input
              ref={otpRef}
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
              placeholder="••••••"
              style={{ fontSize: 24, letterSpacing: '0.4em', textAlign: 'center', fontWeight: 700 }}
            />
          </Field>
          {error && <Alert type="error">{error.message}</Alert>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || otp.length !== 6}>{busy && <Spinner small />} Verify</button>
          <div className="row-between small">
            <button type="button" className="link" onClick={() => { setStep('mobile'); setError(null); }}>Change number</button>
            <button type="button" className="link" disabled={wait > 0 || busy} onClick={send} style={wait > 0 ? { opacity: 0.5 } : undefined}>
              {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {step === 'not-found' && (
        <div className="stack">
          <div className="row"><UserX color="var(--warning-700)" /><strong>Number not in our existing customer list</strong></div>
          <p className="muted mb-0">
            +91 {info?.mobile_masked} is not registered as an existing Nutex customer yet. You can still order as a new customer (minimum {standardMin}),
            or message us on WhatsApp to get your number added.
          </p>
          {wa && (
            <a className="btn btn-whatsapp btn-block" target="_blank" rel="noopener noreferrer"
              href={waLink(wa, `Hello Nutex Team, I am an existing customer. Please add my number ${mobile} for wholesale ordering on the website.`)}>
              <WhatsAppIcon /> Ask Nutex to add my number
            </a>
          )}
          <div className="row">
            <button type="button" className="btn grow" onClick={() => setStep('mobile')}>Try another number</button>
            <button type="button" className="btn btn-dark grow" onClick={onClose}>Continue as new customer</button>
          </div>
        </div>
      )}

      {step === 'alt-mobile' && auth && (
        <form className="stack" onSubmit={sendAlt}>
          <p className="muted mb-0">Add another number you use (for example a second phone). We will send a code to that number on WhatsApp to confirm it is yours. After that you can log in with either number.</p>
          <Field label="Other mobile number">
            <div className="input-prefix">
              <span>+91</span>
              <input className="input" inputMode="numeric" value={altMobile} onChange={(e) => { setAltMobile(digits(e.target.value)); setError(null); }} placeholder="91234 56789" autoFocus style={{ paddingLeft: 44 }} />
            </div>
          </Field>
          {error && <Alert type="error">{error.message}</Alert>}
          <button type="submit" className="btn btn-whatsapp btn-lg btn-block" disabled={busy || wait > 0}>
            {busy ? <Spinner small /> : <WhatsAppIcon />} {wait > 0 ? `Try again in ${wait}s` : 'Send code to this number'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep('done'); setError(null); }}>Back</button>
        </form>
      )}

      {step === 'alt-otp' && auth && (
        <form className="stack" onSubmit={confirmAlt}>
          <p className="mb-0">Enter the 6-digit code sent on WhatsApp to <strong>+91 {info?.mobile_masked}</strong>.</p>
          {info?.dev_otp && <Alert type="warning">Development mode (no WhatsApp account configured): your code is <strong>{info.dev_otp}</strong></Alert>}
          <Field label="WhatsApp code">
            <input ref={otpRef} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={altOtp} onChange={(e) => { setAltOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }} placeholder="••••••" style={{ fontSize: 24, letterSpacing: '0.4em', textAlign: 'center', fontWeight: 700 }} />
          </Field>
          {error && <Alert type="error">{error.message}</Alert>}
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || altOtp.length !== 6}>{busy && <Spinner small />} Confirm number</button>
          <div className="row-between small">
            <button type="button" className="link" onClick={() => { setStep('alt-mobile'); setError(null); }}>Change number</button>
            <button type="button" className="link" disabled={wait > 0 || busy} onClick={sendAlt} style={wait > 0 ? { opacity: 0.5 } : undefined}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>
          </div>
        </form>
      )}

      {step === 'done' && auth && (        <div className="stack" style={{ textAlign: 'center' }}>
          <div className="empty-icon" style={{ margin: '0 auto', background: 'var(--success-100)', color: 'var(--success-700)' }}><BadgeCheck /></div>
          <h3 className="mb-0">You are verified as an existing customer</h3>
          <p className="muted mb-0">+91 {auth.mobile_masked} · {minText(auth.minimum_order_value)}</p>
          <p className="tiny soft mb-0">Remembered on this device until {formatDate(auth.expires_at)}. Use this same mobile number at checkout.</p>
          {notice && <Alert type="success">{notice}</Alert>}
          <div className="card card-pad" style={{ textAlign: 'left', padding: 14 }}>
            <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Your registered numbers</div>
            <div className="chips">
              {(auth.numbers_masked || [auth.mobile_masked]).map((m, i) => <span key={m} className="badge badge-outline">+91 {m}{i === 0 ? ' · main' : ''}</span>)}
            </div>
            <button type="button" className="link small mt-1" onClick={() => { setStep('alt-mobile'); setError(null); setNotice(''); }}>+ Add another WhatsApp number</button>
          </div>          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onClose}>Start shopping</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { logout(); setStep('mobile'); setMobile(''); }}><LogOut /> Not you? Log out</button>
        </div>
      )}
    </Modal>
  );
}

/** Small reusable call-to-action used on home, product page, cart and drawer. */
export function ExistingCustomerPrompt({ compact = false }) {
  const { isExisting, auth, openLogin } = useCustomer();
  if (isExisting) {
    return (
      <div className="alert alert-success" style={{ alignItems: 'center' }}>
        <BadgeCheck />
        <div className="grow">
          <strong>Existing customer verified</strong> (+91 {auth.mobile_masked}).{' '}
          {Number(auth.minimum_order_value) > 0 ? `Your minimum order: ${formatINR(auth.minimum_order_value)}.` : 'No minimum order for you.'}
        </div>
      </div>
    );
  }
  return (
    <div className="existing-cta">
      <BadgeCheck />
      <div className="grow">
        <strong>Existing Nutex customer?</strong>
        {!compact && <span className="small muted" style={{ display: 'block' }}>Verify your mobile on WhatsApp - no minimum order, and you can buy loose pieces in any colour.</span>}
      </div>
      <button type="button" className="btn btn-sm btn-whatsapp" onClick={openLogin}><WhatsAppIcon size={16} /> Verify</button>
    </div>
  );
}
