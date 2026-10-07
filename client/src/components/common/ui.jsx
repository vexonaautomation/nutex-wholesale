import { Component, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, PackageOpen } from 'lucide-react';
import { ORDER_STATUS, PAYMENT_STATUS, RECORD_STATUS } from '../../constants/index.js';
import { initials } from '../../utils/format.js';

export function Spinner({ small }) {
  return <span className={`spinner${small ? ' spinner-sm' : ''}`} aria-hidden="true" />;
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="page-loader" role="status">
      <Spinner />
      <span className="small">{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = PackageOpen, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon /></div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState icon={AlertTriangle} title="Something went wrong" action={onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}>
      {error?.message || 'Please try again.'}
    </EmptyState>
  );
}

const TONES = { ...ORDER_STATUS };
export function StatusBadge({ status, kind = 'order' }) {
  const map = kind === 'payment' ? PAYMENT_STATUS : kind === 'record' ? RECORD_STATUS : TONES;
  const s = map[status] || { label: status || '—', tone: 'outline' };
  return <span className={`badge badge-${s.tone}`}>{s.label}</span>;
}

const ALERT_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: AlertCircle, brand: Info };
export function Alert({ type = 'info', children, className = '' }) {
  const Icon = ALERT_ICONS[type] || Info;
  return (
    <div className={`alert alert-${type} ${className}`} role={type === 'error' ? 'alert' : undefined}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

export function Messages({ messages = [] }) {
  if (!messages.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {messages.map((m, i) => (
        <Alert key={`${m.code}-${i}`} type={m.type === 'success' ? 'success' : m.type === 'warning' ? 'warning' : m.type === 'error' ? 'error' : 'info'}>
          {m.text}
        </Alert>
      ))}
    </div>
  );
}

export function Field({ label, required, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field-label">{label}{required && <span className="req">*</span>}</span>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Image with graceful fallback to a branded placeholder. */
export function Img({ src, alt, className, label, loading = 'lazy', ...rest }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className={`img-ph ${className || ''}`} role="img" aria-label={alt || label || 'Image'}>{initials(label || alt) || 'N'}</div>;
  }
  return <img src={src} alt={alt || ''} className={className} loading={loading} decoding="async" onError={() => setFailed(true)} {...rest} />;
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="container page">
          <EmptyState icon={AlertTriangle} title="This page could not be displayed" action={<button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload page</button>}>
            Please reload the page. If the problem continues, contact us on WhatsApp.
          </EmptyState>
        </div>
      );
    }
    return this.props.children;
  }
}
