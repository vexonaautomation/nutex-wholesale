import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync, useDebounce } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Modal } from '../../components/common/Modal.jsx';
import { Alert, Field, Spinner } from '../../components/common/ui.jsx';
import { formatDate, formatINR } from '../../utils/format.js';
import { useAdmin, isManager } from '../AdminApp.jsx';

// Item-wise credit note: pick the party, search an item. An item supplied to
// the party (handed-over bill) is returned against its bill; an item never
// supplied is "Not given" - the owner / main admin can still return it.

const units = (i, n) => `${n} ${i.sold_in === 'Box' ? (n === 1 ? 'box' : 'boxes') : 'pcs'}`;
const describe = (i) => [i.colour, i.size && `Size ${i.size}`, i.pcs_per_box && `${i.pcs_per_box} pcs per box`].filter(Boolean).join(' · ');
const digits = (v) => String(v).replace(/\D/g, '');

function PartyPicker({ onPick }) {
  const [q, setQ] = useState('');
  const term = useDebounce(q, 300);
  const { data, loading } = useAsync(() => adminApi.get(`/sales-returns/parties?q=${encodeURIComponent(term)}`), [term]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label="Party" hint="Search by party name, mobile or city">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. THE LOOKBOOK or 98XXXXXXXX" autoFocus aria-label="Search party" />
      </Field>
      {loading && !data ? <div className="small muted"><Spinner small /> Searching…</div> : (
        <div className="oe-results">
          {(data?.items || []).map((p) => (
            <button key={p.mobile} type="button" className="oe-result" onClick={() => onPick(p)}>
              <span>
                <span className="cell-main">{p.party_name}</span>
                <span className="cell-sub">{[p.mobile, p.city, `${p.handed_over_orders} handed-over order${p.handed_over_orders === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
          {data && !data.items.length && <div className="small muted">No party found.</div>}
        </div>
      )}
    </div>
  );
}

function ItemSearch({ party, canOverwrite, onAdd }) {
  const [q, setQ] = useState('');
  const term = useDebounce(q, 350);
  const { data, loading } = useAsync(
    () => adminApi.get(`/sales-returns/party-items?mobile=${encodeURIComponent(party.mobile)}&q=${encodeURIComponent(term)}`),
    [party.mobile, term],
  );
  const searched = term.trim().length >= 2;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label="Item" hint="Search by SKU or article name">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 2042 or Sahin Set" autoFocus aria-label="Search item" />
      </Field>
      {loading && !data && <div className="small muted"><Spinner small /> Searching…</div>}
      {data && (
        <div className="oe-results" style={{ maxHeight: 320 }}>
          {data.given.map((i) => (
            <div key={i.order_item_id} className="oe-result" style={{ cursor: 'default', justifyContent: 'space-between' }}>
              <span>
                <span className="cell-main">{i.product_name} <span className="badge badge-success">Given</span></span>
                <span className="cell-sub">{[i.sku, describe(i)].filter(Boolean).join(' · ')}</span>
                <span className="cell-sub">Bill {i.bill_no} · {formatDate(i.bill_date)} · sold {units(i, i.sold)} · can return <strong>{units(i, i.returnable)}</strong></span>
              </span>
              <button type="button" className="btn btn-sm" disabled={!i.returnable} onClick={() => onAdd({ ...i, key: i.order_item_id })}><Plus /> Select</button>
            </div>
          ))}
          {data.not_given.map((v) => (
            <div key={v.variant_id} className="oe-result" style={{ cursor: 'default', justifyContent: 'space-between' }}>
              <span>
                <span className="cell-main">{v.product_name} <span className="badge badge-outline">Not given</span></span>
                <span className="cell-sub">{[v.sku, describe(v)].filter(Boolean).join(' · ')} · today {formatINR(v.unit_rate)} per {v.sold_in === 'Box' ? 'box' : 'pc'}</span>
              </span>
              {canOverwrite
                ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => onAdd({ ...v, key: `ng-${v.variant_id}`, not_given: true, rate: String(v.unit_rate) })}>Return anyway</button>
                : <span className="tiny soft">Owner / main admin only</span>}
            </div>
          ))}
          {!data.given.length && !data.not_given.length && (
            <div className="small muted">{searched ? 'This item was not given to this party and is not in the catalogue.' : 'Nothing supplied to this party on a handed-over order yet.'}</div>
          )}
          {!searched && data.given.length > 0 && <div className="tiny soft">Type 2 letters to also see catalogue items not given to this party.</div>}
        </div>
      )}
    </div>
  );
}

export default function CreateCn({ onClose, onSaved }) {
  const toast = useToast();
  const { admin } = useAdmin();
  const canOverwrite = isManager(admin);
  const [party, setParty] = useState(null);
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const add = (item) => setLines((ls) => (ls.some((l) => l.key === item.key) ? ls : [...ls, { ...item, good: '', damaged: '' }]));
  const set = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const qtyOf = (l) => (Number(l.good) || 0) + (Number(l.damaged) || 0);
  const rateOf = (l) => (l.not_given ? Number(l.rate) || 0 : l.unit_amount);
  const over = lines.find((l) => !l.not_given && qtyOf(l) > l.returnable);
  const total = lines.reduce((s, l) => s + qtyOf(l) * rateOf(l), 0);

  const save = async () => {
    const items = lines.flatMap((l) => ['good', 'damaged'].map((kind) => ({
      ...(l.not_given ? { variant_id: l.variant_id, unit_rate: rateOf(l) } : { order_item_id: l.order_item_id }),
      qty: Number(l[kind]) || 0,
      condition: kind === 'good' ? 'GOOD' : 'DAMAGED',
    }))).filter((x) => x.qty > 0);
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.post('/sales-returns', { mobile: party.mobile, reason, items });
      toast.success(`Credit note ${res.sales_return.return_number} saved.`);
      onSaved(res.sales_return);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      size="lg"
      title="Create CN"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={busy || !party || total <= 0 || !!over || reason.trim().length < 3} onClick={save}>{busy && <Spinner small />} Save CN</button>
        </>
      )}
    >
      <div className="stack">
        {error && <Alert type="error">{error.message}</Alert>}
        {!party ? <PartyPicker onPick={setParty} /> : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div><div className="cell-main">{party.party_name}</div><div className="cell-sub">{[party.mobile, party.city].filter(Boolean).join(' · ')}</div></div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setParty(null); setLines([]); }}><X /> Change party</button>
            </div>
            <ItemSearch party={party} canOverwrite={canOverwrite} onAdd={add} />
            {lines.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Item</th><th className="right">Good</th><th className="right">Damaged</th><th className="right">Rate</th><th /></tr></thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.key}>
                        <td className="cell-main">
                          {l.product_name}
                          <div className="cell-sub">{describe(l)}</div>
                          <div className="cell-sub">{l.not_given ? <strong>Not given to this party</strong> : <>Bill {l.bill_no} · can return {units(l, l.returnable)}</>}</div>
                        </td>
                        <td className="right"><input className="input return-qty" inputMode="numeric" placeholder="0" value={l.good} onChange={(e) => set(l.key, { good: digits(e.target.value) })} aria-label={`Good quantity of ${l.product_name} ${describe(l)}`} /></td>
                        <td className="right"><input className="input return-qty" inputMode="numeric" placeholder="0" value={l.damaged} onChange={(e) => set(l.key, { damaged: digits(e.target.value) })} aria-label={`Damaged quantity of ${l.product_name} ${describe(l)}`} /></td>
                        <td className="right num">
                          {l.not_given
                            ? <input className="input return-qty" inputMode="decimal" value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Rate per unit of ${l.product_name}`} />
                            : formatINR(l.unit_amount)}
                          <div className="tiny soft">per {l.sold_in === 'Box' ? 'box' : 'pc'}</div>
                        </td>
                        <td className="right"><button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove ${l.product_name}`}><Trash2 /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {over && <Alert type="warning">{over.product_name} (bill {over.bill_no}): only {units(over, over.returnable)} can be returned.</Alert>}
            {lines.some((l) => l.not_given) && <Alert type="info">Items marked Not given were never supplied to this party. They are returned by your decision; Good pieces still go back into stock.</Alert>}
            <Field label="Reason for the return" required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. wrong size sent" /></Field>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Credit amount (less packing of a bill comes off when saved)</span>
              <strong>{formatINR(total)}</strong>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
