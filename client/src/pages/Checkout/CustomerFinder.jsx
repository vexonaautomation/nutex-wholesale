import { useEffect, useState } from 'react';
import { Search, UserRound } from 'lucide-react';
import { customerApi } from '../../services/customer.js';
import { useDebounce } from '../../hooks/index.js';
import { Spinner } from '../../components/common/ui.jsx';

/**
 * Admin number at checkout: search a customer by mobile or by name /
 * business / city. Each result shows the name, city and mobile; picking one
 * fills the order details.
 */
export function CustomerFinder({ onPick }) {
  const [q, setQ] = useState('');
  const query = useDebounce(q.trim(), 300);
  const [found, setFound] = useState({ q: '', results: [], error: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) return undefined;
    let live = true;
    setLoading(true);
    customerApi.lookup(query)
      .then((res) => { if (live) setFound({ q: query, results: res.results, error: null }); })
      .catch((error) => { if (live) setFound({ q: query, results: [], error }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query]);

  const show = query.length >= 2 && found.q === query;
  return (
    <div className="customer-finder span-2">
      <label className="field-label" htmlFor="customer-finder">Find customer <span className="soft">- mobile number or name</span></label>
      <div className="finder-search">
        <Search />
        <input id="customer-finder" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 98765 or Riya Fashion" autoComplete="off" />
        {loading && <Spinner small />}
      </div>
      {show && found.error && <div className="field-error">{found.error.message}</div>}
      {show && !found.error && !found.results.length && <div className="small muted mt-1">No customer found - fill the details below.</div>}
      {show && found.results.length > 0 && (
        <div className="finder-results" role="listbox" aria-label="Customers">
          {found.results.map((c) => (
            <button key={c.mobile} type="button" role="option" aria-selected="false" className="finder-result" onClick={() => { onPick(c); setQ(''); }}>
              <UserRound />
              <span>
                <strong>{c.business_name || c.customer_name || 'Customer'}</strong>{c.business_name && c.customer_name ? ` · ${c.customer_name}` : ''}
                <span className="small muted">{[c.city, c.mobile].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
