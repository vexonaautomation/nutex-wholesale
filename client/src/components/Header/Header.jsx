import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { BadgeCheck, ChevronDown, Menu, Search, ShoppingBag, PackageSearch, ChevronRight, UserRound } from 'lucide-react';
import { useStore } from '../../context/StoreContext.jsx';
import { useCart } from '../../context/CartContext.jsx';
import { useCustomer } from '../../context/CustomerContext.jsx';
import { Drawer } from '../common/Modal.jsx';
import { formatINR } from '../../utils/format.js';
import { discountHeadline } from '../../utils/pricing.js';
import { WhatsAppIcon } from '../common/Icons.jsx';
import { waLink, waNumber } from '../../utils/whatsapp.js';

const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export function Logo({ settings }) {
  const name = settings?.company_name || 'Nutex Apparel Limited';
  return (
    <Link to="/" className="brand" aria-label={`${name} home`}>
      {settings?.company_logo_url ? (
        <img src={settings.company_logo_url} alt={name} />
      ) : (
        <>
          <span className="brand-mark">N</span>
          <span className="brand-text">
            <span className="brand-name">{name.replace(/\s+(Apparel\s+)?(Limited|Ltd\.?)$/i, '') || name}</span>
            <span className="brand-tag">Wholesale</span>
          </span>
        </>
      )}
    </Link>
  );
}

export function Header() {
  const { settings, groups, slabs } = useStore();
  const cart = useCart();
  const customer = useCustomer();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const wa = waNumber(settings);

  const announcement = settings?.announcement_text
    || (settings ? (customer.isExisting
      ? `Welcome back · Existing customer - no minimum order · ${discountHeadline(settings, slabs)}`
      : `Wholesale only · Minimum order ${formatINR(settings.minimum_order_value)} (final value after discount) · ${discountHeadline(settings, slabs)}`) : '');

  const onSearch = (e) => {
    e.preventDefault();
    navigate(`/shop${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
    setMenuOpen(false);
  };

  return (
    <>
      {announcement && (
        <div className="announce">
          <strong>{announcement}</strong>
          {!customer.isExisting && (
            <button type="button" className="announce-cta" onClick={customer.openLogin}>Existing customer? Login for no minimum →</button>
          )}
        </div>
      )}
      <header className="site-header">
        <div className="container header-inner">
          <button type="button" className="btn btn-ghost btn-icon mobile-only" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu /></button>
          <Logo settings={settings} />
          <nav className="main-nav" aria-label="Main">
            <NavLink to="/shop" end>Shop All</NavLink>
            {groups.map((g) => (
              <div className="nav-group" key={g.name}>
                <button type="button" aria-haspopup="true">{titleCase(g.name)} <ChevronDown size={14} /></button>
                <div className="nav-menu">
                  {g.categories.map((c) => (
                    <Link key={c.category_id} to={`/category/${c.slug}`}>
                      <span>{c.name}</span>
                      <span className="soft small">{c.product_count}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <NavLink to="/track-order">Track Order</NavLink>
            <NavLink to="/contact">Contact</NavLink>
          </nav>
          <div className="header-actions">
            <form className="header-search" onSubmit={onSearch} role="search">
              <Search />
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or SKU" aria-label="Search products" />
            </form>
            <button
              type="button"
              className={`btn btn-sm customer-btn ${customer.isExisting ? 'is-verified' : ''}`}
              onClick={customer.openLogin}
              aria-label={customer.isExisting ? 'Existing customer verified' : 'Existing customer login'}
            >
              {customer.isExisting ? <BadgeCheck /> : <UserRound />}
              <span className="hide-sm">{customer.isExisting ? 'Existing customer' : 'Existing customer?'}</span>
            </button>
            {wa && (
              <a className="btn btn-ghost btn-icon hide-xs" href={waLink(wa, 'Hello Nutex Team, I have a wholesale enquiry.')} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp us">
                <WhatsAppIcon size={20} />
              </a>
            )}
            <button type="button" className="btn btn-ghost btn-icon cart-btn" onClick={cart.openDrawer} aria-label={`Cart, ${cart.count} items`}>
              <ShoppingBag />
              {cart.count > 0 && <span className="cart-count">{cart.count > 999 ? '999+' : cart.count}</span>}
            </button>
          </div>
        </div>
      </header>
      {cart.editing && (
        <div className="edit-banner">
          <div className="container">
            <strong>Editing order {cart.editing.order_number}</strong>
            <span>Changes are saved only when you click “Update order”.</span>
            <span className="grow" />
            <Link className="btn btn-sm btn-dark" to="/cart">Review &amp; update</Link>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                const n = cart.editing.order_number;
                cart.stopEditing();
                navigate(`/order/${n}`);
              }}
            >
              Cancel editing
            </button>
          </div>
        </div>
      )}

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <form onSubmit={onSearch} className="input-group mb-2" role="search">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or SKU" aria-label="Search products" />
          <button className="btn" type="submit" aria-label="Search"><Search /></button>
        </form>
        <nav className="mobile-nav" onClick={(e) => e.target.closest('a') && setMenuOpen(false)}>
          <Link to="/shop">Shop all products <ChevronRight size={16} /></Link>
          {groups.map((g) => (
            <div key={g.name}>
              <h4>{titleCase(g.name)}</h4>
              {g.categories.map((c) => (
                <Link key={c.category_id} to={`/category/${c.slug}`}>{c.name} <span className="soft small">{c.product_count}</span></Link>
              ))}
            </div>
          ))}
          <h4>Orders</h4>
          <button type="button" className="mobile-nav-btn" onClick={() => { setMenuOpen(false); customer.openLogin(); }}>
            {customer.isExisting ? 'Existing customer (verified)' : 'Existing customer login'} <BadgeCheck size={16} />
          </button>
          <Link to="/cart">Cart <ShoppingBag size={16} /></Link>
          <Link to="/track-order">Track order <PackageSearch size={16} /></Link>
          <Link to="/contact">Contact us <ChevronRight size={16} /></Link>
        </nav>
      </Drawer>
    </>
  );
}
