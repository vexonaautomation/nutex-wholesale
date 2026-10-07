import { Link } from 'react-router-dom';
import { useStore } from '../../context/StoreContext.jsx';
import { POLICY_PAGES } from '../../constants/index.js';
import { formatINR } from '../../utils/format.js';

export function Footer() {
  const { settings, categories } = useStore();
  const name = settings?.company_name || 'Nutex Apparel Limited';
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">{name}</div>
            <p className="mb-2">{settings?.company_tagline}</p>
            {settings?.company_address && <p className="mb-1" style={{ whiteSpace: 'pre-line' }}>{settings.company_address}</p>}
            {settings?.company_phone && <p className="mb-1">Phone: <a href={`tel:${settings.company_phone}`}>{settings.company_phone}</a></p>}
            {settings?.company_email && <p className="mb-1">Email: <a href={`mailto:${settings.company_email}`}>{settings.company_email}</a></p>}
            {settings?.company_gstin && <p className="mb-1">GSTIN: {settings.company_gstin}</p>}
          </div>
          <div>
            <h4>Shop</h4>
            <ul>
              <li><Link to="/shop">All products</Link></li>
              {categories.slice(0, 8).map((c) => <li key={c.category_id}><Link to={`/category/${c.slug}`}>{c.name}</Link></li>)}
            </ul>
          </div>
          <div>
            <h4>Ordering</h4>
            <ul>
              <li><Link to="/cart">Cart</Link></li>
              <li><Link to="/track-order">Track order</Link></li>
              <li><Link to="/contact">Contact us</Link></li>
              {settings && <li className="soft">Minimum order {formatINR(settings.minimum_order_value)}</li>}
            </ul>
          </div>
          <div>
            <h4>Policies</h4>
            <ul>
              {POLICY_PAGES.map((p) => <li key={p.slug}><Link to={`/policies/${p.slug}`}>{p.title}</Link></li>)}
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {name}. All rights reserved.</span>
          <span>Wholesale orders only · Prices shown are calculated and confirmed at checkout</span>
        </div>
      </div>
    </footer>
  );
}
