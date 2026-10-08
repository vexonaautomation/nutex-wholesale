import { lazy, Suspense, useEffect } from 'react';
import { Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { CustomerProvider } from './context/CustomerContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { Header } from './components/Header/Header.jsx';
import { Footer } from './components/Footer/Footer.jsx';
import { CartDrawer } from './components/CartDrawer/CartDrawer.jsx';
import { StickyCartBar } from './components/CartDrawer/StickyCartBar.jsx';
import { ErrorBoundary, PageLoader } from './components/common/ui.jsx';
import './styles/shop.css';

import Home from './pages/Home/Home.jsx';
import Shop from './pages/Shop/Shop.jsx';
import Category from './pages/Category/Category.jsx';
import Product from './pages/Product/Product.jsx';
import Cart from './pages/Cart/Cart.jsx';
import Checkout from './pages/Checkout/Checkout.jsx';
import Payment from './pages/Payment/Payment.jsx';
import ThankYou from './pages/ThankYou/ThankYou.jsx';
import Order from './pages/Order/Order.jsx';
import TrackOrder from './pages/TrackOrder/TrackOrder.jsx';
import Contact from './pages/Contact/Contact.jsx';
import Legal from './pages/Legal/Legal.jsx';
import NotFound from './pages/NotFound/NotFound.jsx';

// The admin panel is a separate lazily-loaded bundle (ERP UI + its own CSS).
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function StoreLayout() {
  return (
    <>
      <Header />
      <main id="main">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <Footer />
      <CartDrawer />
      <StickyCartBar />
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ScrollToTop />
      <Routes>
        <Route
          path="/admin/*"
          element={(
            <Suspense fallback={<PageLoader label="Loading admin panel…" />}>
              <AdminApp />
            </Suspense>
          )}
        />
        <Route
          element={(
            <StoreProvider>
              <CustomerProvider>
                <CartProvider>
                  <StoreLayout />
                </CartProvider>
              </CustomerProvider>
            </StoreProvider>
          )}
        >
          <Route index element={<Home />} />
          <Route path="shop" element={<Shop />} />
          <Route path="category/:slug" element={<Category />} />
          <Route path="product/:slug" element={<Product />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order/:orderNumber" element={<Order />} />
          <Route path="order/:orderNumber/payment" element={<Payment />} />
          <Route path="order/:orderNumber/thank-you" element={<ThankYou />} />
          <Route path="track-order" element={<TrackOrder />} />
          <Route path="contact" element={<Contact />} />
          <Route path="policies/:slug" element={<Legal />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
