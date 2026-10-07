import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../services/auth.js';
import { PageLoader } from '../components/common/ui.jsx';
import './admin.css';
import AdminLayout from './AdminLayout.jsx';
import Login from './Login/Login.jsx';
import Dashboard from './Dashboard/Dashboard.jsx';
import ProductList from './Products/ProductList.jsx';
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

const AuthContext = createContext(null);
export const useAdmin = () => useContext(AuthContext);

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
          <Route path="products" element={<ProductList />} />
          <Route path="products/new" element={<ProductWizard />} />
          <Route path="products/:id" element={<ProductWizard />} />
          <Route path="catalog-import" element={<CatalogImport />} />
          <Route path="categories" element={<Categories />} />
          <Route path="colors" element={<Colors />} />
          <Route path="sizes" element={<Sizes />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="discount-slabs" element={<DiscountSlabs />} />
          <Route path="orders" element={<OrderList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="payments" element={<Payments />} />
          <Route path="customers" element={<Customers />} />
          <Route path="existing-customers" element={<ExistingCustomers />} />
          <Route path="settings" element={<Settings />} />
          <Route path="audit-log" element={<AuditLog />} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Route>
      </Routes>
    </AuthContext.Provider>
  );
}
