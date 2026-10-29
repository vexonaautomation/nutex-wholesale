import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../services/auth.js';
import { PageLoader } from '../components/common/ui.jsx';
import './admin.css';
import AdminLayout from './AdminLayout.jsx';
import Login from './Login/Login.jsx';
import Dashboard from './Dashboard/Dashboard.jsx';
import ProductList from './Products/ProductList.jsx';
import PackSizes from './Products/PackSizes.jsx';
import ProductWizard from './Products/ProductWizard.jsx';
import Categories from './Categories/Categories.jsx';
import Colors from './Colors/Colors.jsx';
import Sizes from './Sizes/Sizes.jsx';
import Inventory from './Inventory/Inventory.jsx';
import DiscountSlabs from './DiscountSlabs/DiscountSlabs.jsx';
import OrderList from './Orders/OrderList.jsx';
import OrderDetail from './Orders/OrderDetail.jsx';
import Payments from './Payments/Payments.jsx';
import Customers from './Customers/Customers.jsx';
import ExistingCustomers from './ExistingCustomers/ExistingCustomers.jsx';
import Settings from './Settings/Settings.jsx';
import AuditLog from './AuditLog/AuditLog.jsx';
import CatalogImport from './CatalogImport/CatalogImport.jsx';
import SubAdmins from './SubAdmins/SubAdmins.jsx';
import Packers from './Packers/Packers.jsx';
import Analytics from './Analytics/Analytics.jsx';
import { MyAccount } from './Settings/Settings.jsx';
import { PageHeader } from './components.jsx';

const AuthContext = createContext(null);
export const useAdmin = () => useContext(AuthContext);

// Sub admins see the Orders tab + small dashboard + what the owner ticked.
export const isSubAdmin = (admin) => admin?.role === 'SUB_ADMIN';
export const isManager = (admin) => ['OWNER', 'ADMIN'].includes(admin?.role);
/** permission: a sub admin key ("products"...), "full" (not for sub admins) or "manager" (owner / admin). */
export function allowed(admin, permission) {
  if (!permission) return true;
  if (permission === 'manager') return isManager(admin);
  if (permission === 'full') return !isSubAdmin(admin);
  return !isSubAdmin(admin) || (admin.permissions || []).includes(permission);
}
export const useCan = () => {
  const { admin } = useAdmin();
  return (permission) => allowed(admin, permission);
};

function Need({ permission, children }) {
  const { admin } = useAdmin();
  return allowed(admin, permission) ? children : <Navigate to="/admin/dashboard" replace />;
}

function Account() {
  return (
    <>
      <PageHeader title="My account" subtitle="Change your password. Other sessions are signed out." />
      <div className="card card-pad"><MyAccount /></div>
    </>
  );
}

export default function AdminApp() {
  const [state, setState] = useState({ loading: true, admin: null });
  const navigate = useNavigate();
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      const { admin } = await authApi.me();
      setState({ loading: false, admin });
    } catch {
      setState({ loading: false, admin: null });
    }
  }, []);

  useEffect(() => {
    document.title = 'Admin | Nutex Wholesale';
    const robots = document.querySelector('meta[name="robots"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'robots' }));
    robots.setAttribute('content', 'noindex,nofollow');
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      setState({ loading: false, admin: null });
      navigate('/admin', { replace: true, state: { from: location.pathname, expired: true } });
    };
    window.addEventListener('nutex:admin-unauthorized', onUnauthorized);
    return () => window.removeEventListener('nutex:admin-unauthorized', onUnauthorized);
  }, [navigate, location.pathname]);

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setState({ loading: false, admin: null });
      navigate('/admin', { replace: true });
    }
  };

  if (state.loading) return <PageLoader label="Checking session…" />;

  return (
    <AuthContext.Provider value={{ admin: state.admin, refresh, logout, setAdmin: (admin) => setState({ loading: false, admin }) }}>
      <Routes>
        <Route index element={state.admin ? <Navigate to="/admin/dashboard" replace /> : <Login />} />
        <Route element={state.admin ? <AdminLayout /> : <Navigate to="/admin" replace state={{ from: location.pathname }} />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="products" element={<Need permission="products"><ProductList /></Need>} />
          <Route path="pack-sizes" element={<Need permission="products"><PackSizes /></Need>} />
          <Route path="products/new" element={<Need permission="products"><ProductWizard /></Need>} />
          <Route path="products/:id" element={<Need permission="products"><ProductWizard /></Need>} />
          <Route path="catalog-import" element={<Need permission="full"><CatalogImport /></Need>} />
          <Route path="categories" element={<Need permission="products"><Categories /></Need>} />
          <Route path="colors" element={<Need permission="products"><Colors /></Need>} />
          <Route path="sizes" element={<Need permission="products"><Sizes /></Need>} />
          <Route path="inventory" element={<Need permission="inventory"><Inventory /></Need>} />
          <Route path="discount-slabs" element={<Need permission="pricing"><DiscountSlabs /></Need>} />
          <Route path="orders" element={<OrderList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="analytics" element={<Need permission="manager"><Analytics /></Need>} />
          <Route path="payments" element={<Need permission="payments"><Payments /></Need>} />
          <Route path="customers" element={<Need permission="customers"><Customers /></Need>} />
          <Route path="existing-customers" element={<Need permission="customers"><ExistingCustomers /></Need>} />
          <Route path="sub-admins" element={<Need permission="manager"><SubAdmins /></Need>} />
          <Route path="packers" element={<Need permission="manager"><Packers /></Need>} />
          <Route path="account" element={<Account />} />
          <Route path="settings" element={<Need permission="full"><Settings /></Need>} />
          <Route path="audit-log" element={<Need permission="full"><AuditLog /></Need>} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}
