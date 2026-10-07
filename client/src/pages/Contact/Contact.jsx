import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import { useSeo } from '../../hooks/index.js';
import { WhatsAppIcon } from '../../components/common/Icons.jsx';
import { waLink, waNumber } from '../../utils/whatsapp.js';
import { PageLoader } from '../../components/common/ui.jsx';

export default function Contact() {
  const { settings } = useStore();
  useSeo({ title: `Contact Us | ${settings?.company_name || 'Nutex'} Wholesale`, description: 'Contact the Nutex wholesale team for orders, payments and support.' });
  if (!settings) return <PageLoader />;
  const wa = waNumber(settings);
  return (
    <div className="container page">
      <span className="eyebrow">Contact</span>
      <h1 className="page-title">We are here to help</h1>
      <p className="muted" style={{ maxWidth: 640 }}>{settings.support_message}</p>
      <div className="two-col mt-3">
        <div className="card card-pad stack">
          <h2 className="card-title">{settings.company_name}</h2>
          {settings.company_address && <div className="info-tile"><MapPin /><div style={{ whiteSpace: 'pre-line' }}>{settings.company_address}</div></div>}
          {settings.company_phone && <div className="info-tile"><Phone /><a href={`tel:${settings.company_phone}`}>{settings.company_phone}</a></div>}
          {settings.company_email && <div className="info-tile"><Mail /><a href={`mailto:${settings.company_email}`}>{settings.company_email}</a></div>}
          {settings.business_hours && <div className="info-tile"><Clock /><div>{settings.business_hours}</div></div>}
          {settings.company_gstin && <div className="small muted">GSTIN: {settings.company_gstin}</div>}
          {!settings.company_address && !settings.company_phone && !settings.company_email && (
            <p className="muted">Contact details will be published soon. Please message us on WhatsApp.</p>
          )}
        </div>
        {wa && (
          <div className="wa-band">
            <div>
              <h2>Chat on WhatsApp</h2>
              <p>Order enquiries, size availability, payment confirmation and dispatch updates.</p>
            </div>
            <a className="btn btn-whatsapp btn-lg" href={waLink(wa, 'Hello Nutex Team, I have a wholesale enquiry.')} target="_blank" rel="noopener noreferrer"><WhatsAppIcon /> +{wa}</a>
          </div>
        )}
      </div>
    </div>
  );
}
