import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BadgeCheck, BadgePercent, BookOpen, Boxes, ClipboardList, CreditCard, FolderTree, KeyRound, LayoutDashboard, LogOut, Menu, Package, PackageCheck, Palette, Ruler,
  BarChart3, ScrollText, Settings as SettingsIcon, Shirt, Store, UserCog, Users,
} from 'lucide-react';
import { useAdmin, allowed, isSubAdmin } from './AdminApp.jsx';
import { ErrorBoundary } from '../components/common/ui.jsx';
import { initials } from '../utils/format.js';

// [path, label, icon, permission] - see allowed() in AdminApp
const NAV = [
  ['Overview', [['/admin/dashboard', 'Dashboard', LayoutDashboard]]],
  ['Catalog', [
    ['/admin/products', 'Products', Shirt, 'products'],
    ['/admin/pack-sizes', 'Pack of (pcs / box)', Package, 'products'],
    ['/admin/catalog-import', 'Catalogue Import', BookOpen, 'full'],
    ['/admin/categories', 'Categories', FolderTree, 'products'],
    ['/admin/colors', 'Colors', Palette, 'products'],
    ['/admin/sizes', 'Sizes', Ruler, 'products'],
    ['/admin/inventory', 'Inventory', Boxes, 'inventory'],
  ]],
  ['Pricing', [['/admin/discount-slabs', 'Discount Slabs', BadgePercent, 'pricing']]],
  ['Sales', [
    ['/admin/orders', 'Orders', ClipboardList],
    ['/admin/analytics', 'Analytics', BarChart3, 'manager'],
    ['/admin/payments', 'Payments', CreditCard, 'payments'],
    ['/admin/customers', 'Customers', Users, 'customers'],
    ['/admin/existing-customers', 'Existing Customers', BadgeCheck, 'customers'],
    ['/admin/packers', 'Packing team', PackageCheck, 'manager'],
  ]],
  ['System', [
    ['/admin/sub-admins', 'Sub admins', UserCog, 'manager'],
    ['/admin/settings', 'Settings', SettingsIcon, 'full'],
    ['/admin/audit-log', 'Audit Log', ScrollText, 'full'],
  ]],
];
const ROLE_LABEL = { OWNER: 'Owner', ADMIN: 'Admin', STAFF: 'Staff', SUB_ADMIN: 'Sub admin' };

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
          {NAV.map(([group, all]) => {
            const items = all.filter(([, , , permission]) => allowed(admin, permission));
            if (isSubAdmin(admin) && group === 'System') items.push(['/admin/account', 'My account', KeyRound]);
            return items.length ? (
              <div key={group}>
                <h6>{group}</h6>
                {items.map(([to, label, Icon]) => <NavLink key={to} to={to}><Icon />{label}</NavLink>)}
              </div>
            ) : null;
          })}
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
            <span className="small" style={{ lineHeight: 1.2 }}><strong>{admin?.name}</strong><br /><span className="soft">{ROLE_LABEL[admin?.role] || admin?.role}</span></span>
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
