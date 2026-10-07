import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { authApi } from '../../services/auth.js';
import { useAdmin } from '../AdminApp.jsx';
import { Alert, Field, Spinner } from '../../components/common/ui.jsx';

export default function Login() {
  const { setAdmin } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { admin } = await authApi.login(email.trim(), password);
      setAdmin(admin);
      navigate(location.state?.from && location.state.from !== '/admin' ? location.state.from : '/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card stack" onSubmit={submit}>
        <div className="row">
          <span className="brand-mark" style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--brand-800)', color: 'var(--brand-100)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700 }}>N</span>
          <div><strong style={{ fontSize: 18 }}>Nutex Admin</strong><div className="small soft">Wholesale management panel</div></div>
        </div>
        {location.state?.expired && <Alert type="warning">Your session expired. Please sign in again.</Alert>}
        <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error && <Alert type="error">{error.message}</Alert>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? <Spinner small /> : <LockKeyhole />} Sign in</button>
        <p className="tiny soft mb-0">Authorised Nutex staff only. All admin actions are recorded in the audit log.</p>
      </form>
    </div>
  );
}
