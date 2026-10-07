import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadCustomerAuth, saveCustomerAuth, clearCustomerAuth, customerApi } from '../services/customer.js';
import { ExistingCustomerLogin } from '../components/ExistingCustomerLogin/ExistingCustomerLogin.jsx';

const CustomerContext = createContext(null);

/**
 * Existing-customer status for this device. Verification (WhatsApp OTP) can be
 * started from anywhere - header, homepage, product page, cart - BEFORE the
 * customer has selected anything.
 */
export function CustomerProvider({ children }) {
  const [auth, setAuth] = useState(loadCustomerAuth);
  const [loginOpen, setLoginOpen] = useState(false);

  // Re-validate a stored token once per visit (the admin may have removed the number).
  useEffect(() => {
    const stored = loadCustomerAuth();
    if (!stored) return;
    customerApi.status(stored.token)
      .then((s) => {
        if (!s.existing) {
          clearCustomerAuth();
          setAuth(null);
        } else {
          const next = { ...stored, minimum_order_value: s.minimum_order_value, mobile: s.mobile || stored.mobile, numbers_masked: s.numbers_masked || stored.numbers_masked };
          saveCustomerAuth(next);
          setAuth(next);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'nutex_customer_auth_v1') setAuth(loadCustomerAuth());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback((res) => {
    const next = {
      token: res.token,
      expires_at: res.expires_at,
      mobile: res.mobile,
      mobile_masked: res.mobile_masked,
      numbers_masked: res.numbers_masked || [res.mobile_masked],
      minimum_order_value: res.minimum_order_value,
    };
    saveCustomerAuth(next);
    setAuth(next);
  }, []);

  const setNumbers = useCallback((numbersMasked) => {
    setAuth((a) => {
      if (!a) return a;
      const next = { ...a, numbers_masked: numbersMasked };
      saveCustomerAuth(next);
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    clearCustomerAuth();
    setAuth(null);
  }, []);

  const value = useMemo(() => ({
    auth,
    isExisting: Boolean(auth),
    login,
    logout,
    setNumbers,
    openLogin: () => setLoginOpen(true),
    closeLogin: () => setLoginOpen(false),
  }), [auth, login, logout, setNumbers]);

  return (
    <CustomerContext.Provider value={value}>
      {children}
      <ExistingCustomerLogin open={loginOpen} onClose={() => setLoginOpen(false)} />
    </CustomerContext.Provider>
  );
}

export const useCustomer = () => useContext(CustomerContext);
