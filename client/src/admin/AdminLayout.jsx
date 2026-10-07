import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BadgeCheck, BadgePercent, BookOpen, Boxes, ClipboardList, CreditCard, FolderTree, LayoutDashboard, LogOut, Menu, Palette, Ruler,
  ScrollText, Settings as SettingsIcon, Shirt, Store, Users,
} from 'lucide-react';
import { useAdmin } from './AdminApp.jsx';
import { ErrorBoundary } from '../components/common/ui.jsx';
import { initials } from '../utils/format.js';

const NAV = [
  ['Overview', [['/admin/dashboard', 'Dashboard', LayoutDashboard]]],
  ['Catalog', [
    ['/admin/products', 'Products', Shirt],
    ['/admin/catalog-import', 'Catalogue Import', BookOpen],
    ['/admin/categories', 'Categories', FolderTree],
    ['/admin/colors', 'Colors', Palette],
    ['/admin/sizes', 'Sizes', Ruler],
    ['/admin/inventory', 'Inventory', Boxes],
  ]],
  ['Pricing', [['/admin/discount-slabs', 'Discount Slabs', BadgePercent]]],
  ['Sales', [
    ['/admin/orders', 'Orders', ClipboardList],
    ['/admin/payments', 'Payments', CreditCard],
    ['/admin/customers', 'Customers', Users],
    ['/admin/existing-customers', 'Existing Customers', BadgeCheck],
  ]],
  ['System', [
    ['/admin/settings', 'Settings', SettingsIcon],
    ['/admin/audit-log', 'Audit Log', ScrollText],
  ]],
];

export default function AdminLayout() {
  const { admin, logout } = useAdmin();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="admin">
      {open && <div className="overlay" style={{ zIndex: 94 }} onClick={() => setOpen(false)} />}
      <aside className={`adm-side ${open ? 'is-open' : ''}`}>
        <div className="adm-brand">
          <span className="brand-mark">N</span>
          <div><strong>Nutex Admin</strong><small>Wholesale ERP</small></div>
        </div>
        <nav className="adm-nav">
          {NAV.map(([group, items]) => (
            <div key={group}>
              <h6>{group}</h6>
              {items.map(([to, label, Icon]) => <NavLink key={to} to={to}><Icon />{label}</NavLink>)}
            </div>
          ))}
          <h6>Website</h6>
          <a href="/" target="_blank" rel="noopener noreferrer"><Store />View store</a>
        </nav>
        <div className="adm-side-foot">Data: Google Sheets · Files: Google Drive</div>
      </aside>
      <div className="adm-main">
        <header className="adm-top">
          <button type="button" className="btn btn-ghost btn-icon adm-burger" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="adm-user">
            <span className="adm-avatar">{initials(admin?.name || admin?.email)}</span>
            <span className="small" style={{ lineHeight: 1.2 }}><strong>{admin?.name}</strong><br /><span className="soft">{admin?.role}</span></span>
            <button type="button" className="btn btn-sm" onClick={logout}><LogOut /> Sign out</button>
          </div>
        </header>
        <main className="adm-content">
          <ErrorBoundary key={pathname}><Outlet /></ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
