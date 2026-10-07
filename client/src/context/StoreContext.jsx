import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';

const StoreContext = createContext(null);

// Storefront bootstrap: settings, categories, colors, sizes and live slabs -
// all managed by admins in Google Sheets. Nothing here is hard-coded.
export function StoreProvider({ children }) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/store');
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState((s) => ({ data: s.data, loading: false, error }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo(() => {
    const d = state.data;
    const categories = d?.categories || [];
    const groups = [];
    for (const c of categories) {
      const g = c.parent_category || 'COLLECTIONS';
      let group = groups.find((x) => x.name === g);
      if (!group) groups.push((group = { name: g, categories: [] }));
      group.categories.push(c);
    }
    return {
      loading: state.loading,
      error: state.error,
      reload: load,
      settings: d?.settings || null,
      categories,
      groups,
      colors: d?.colors || [],
      sizes: d?.sizes || [],
      slabs: d?.slabs || [],
    };
  }, [state, load]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}
