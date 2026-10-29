import { useMemo, useState } from 'react';
import {
  BarChart3, Boxes, ClipboardEdit, Download, IndianRupee, Package, Percent, ShoppingBag, TrendingDown, Users, XCircle,
} from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { qs } from '../../services/api.js';
import { useAsync } from '../../hooks/index.js';
import { PageHeader, SearchBox, Stat } from '../components.jsx';
import { ErrorState, PageLoader, Spinner } from '../../components/common/ui.jsx';
import { formatDateTime, formatINR } from '../../utils/format.js';

// Admin > Analytics (owner / admin only): sales by party, item, category,
// size, colour, team member and day, for the chosen dates.

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return ymd(d); };
const PRESETS = [
  ['Today', () => [shift(0), shift(0)]],
  ['Last 7 days', () => [shift(-6), shift(0)]],
  ['This month', () => { const d = new Date(); d.setDate(1); return [ymd(d), shift(0)]; }],
  ['Last month', () => { const s = new Date(); s.setDate(1); s.setMonth(s.getMonth() - 1); const e = new Date(); e.setDate(0); return [ymd(s), ymd(e)]; }],
  ['This year', () => [`${new Date().getFullYear()}-01-01`, shift(0)]],
];
const SCOPES = [
  ['confirmed', 'Paid / confirmed orders'],
  ['handed_over', 'Handed over only'],
  ['all', 'All orders (not cancelled)'],
];
const num = (v) => (v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const rupee = (v) => (v === null || v === undefined ? '-' : v < 0 ? `-${formatINR(-v)}` : formatINR(v));
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

// [key, label, format, align]
const COMMON = [
  ['pcs', 'Pcs', num, 'right'], ['dzn', 'Dzn', num, 'right'], ['boxes', 'Boxes', num, 'right'],
  ['amount', 'Amount', rupee, 'right'], ['avg_rate', 'Avg rate / pc', rupee, 'right'], ['orders', 'Orders', num, 'right'],
];
const TABLES = {
  parties: {
    label: 'Party-wise',
    search: ['party', 'customer', 'city', 'mobile'],
    columns: [['party', 'Party'], ['customer', 'Customer'], ['city', 'City'], ['mobile', 'Mobile'], ['type', 'Type'], ...COMMON,
      ['avg_order', 'Avg order', rupee, 'right'], ['last_order', 'Last order', (v) => (v ? formatDateTime(v) : '-')]],
  },
  items: {
    label: 'Item-wise',
    search: ['sku', 'product', 'category'],
    columns: [['sku', 'SKU'], ['product', 'Product'], ['category', 'Category'], ...COMMON,
      ['mrp_total', 'MRP value', rupee, 'right'], ['parties', 'Parties', num, 'right']],
  },
  categories: { label: 'Category-wise', search: ['category'], columns: [['category', 'Category'], ...COMMON, ['parties', 'Parties', num, 'right']] },
  sizes: { label: 'Size-wise', search: ['size'], columns: [['size', 'Size'], ...COMMON] },
  colours: { label: 'Colour-wise', search: ['colour'], columns: [['colour', 'Colour'], ...COMMON] },
  team: { label: 'Made by', search: ['name'], columns: [['name', 'Made by'], ...COMMON, ['parties', 'Parties', num, 'right']] },
  shortage: {
    label: 'Short supply',
    sortKey: 'short_amount',
    search: ['product', 'sku', 'colour', 'size'],
    totals: ['ordered_pcs', 'supplied_pcs', 'short_pcs', 'extra_pcs', 'short_amount'],
    columns: [['product', 'Product'], ['colour', 'Colour'], ['size', 'Size'], ['ordered_pcs', 'Ordered pcs', num, 'right'],
      ['supplied_pcs', 'Supplied pcs', num, 'right'], ['short_pcs', 'Short pcs', num, 'right'], ['extra_pcs', 'Extra pcs', num, 'right'],
      ['fill_rate', 'Fill %', (v) => (v === null ? '-' : `${num(v)}%`), 'right'], ['short_amount', 'Short ₹', rupee, 'right'], ['orders', 'Orders', num, 'right']],
  },
  changed: {
    label: 'Changed after packing',
    sortKey: 'diff_amount',
    sortDir: 1,
    search: ['bill', 'party', 'changes'],
    totals: ['ordered_pcs', 'supplied_pcs', 'diff_pcs', 'ordered_amount', 'supplied_amount', 'diff_amount'],
    columns: [['bill', 'Bill'], ['party', 'Party'], ['date', 'Order date', (v) => (v ? formatDateTime(v) : '-')],
      ['ordered_pcs', 'Ordered pcs', num, 'right'], ['supplied_pcs', 'Supplied pcs', num, 'right'], ['diff_pcs', 'Diff pcs', num, 'right'],
      ['ordered_amount', 'Ordered ₹', rupee, 'right'], ['supplied_amount', 'Supplied ₹', rupee, 'right'], ['diff_amount', 'Diff ₹', rupee, 'right'],
      ['changes', 'What changed (pcs: ordered → supplied)']],
  },
};

function csv(name, columns, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns.map(([, l]) => l), ...rows.map((r) => columns.map(([k]) => r[k]))].map((line) => line.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

function DataTable({ id, rows, range }) {
  const def = TABLES[id];
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: def.sortKey || 'amount', dir: def.sortDir || -1 });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? rows.filter((r) => def.search.some((k) => String(r[k] ?? '').toLowerCase().includes(needle))) : rows;
    return [...list].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (typeof x === 'number' || typeof y === 'number') return ((Number(x) || 0) - (Number(y) || 0)) * sort.dir;
      return String(x ?? '').localeCompare(String(y ?? '')) * sort.dir;
    });
  }, [rows, q, sort, def]);
  const totals = useMemo(() => (def.totals || ['pcs', 'dzn', 'boxes', 'amount']).reduce((t, k) => ({ ...t, [k]: shown.reduce((s, r) => s + (Number(r[k]) || 0), 0) }), {}), [shown, def]);
  return (
    <>
      <div className="filter-bar">
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${def.label.toLowerCase()}…`} />
        <button type="button" className="btn btn-sm" onClick={() => csv(`${def.label} ${range}`, def.columns, shown)} disabled={!shown.length}><Download /> Download CSV</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="right">#</th>
              {def.columns.map(([k, l, , align]) => (
                <th key={k} className={`is-clickable ${align || ''}`} onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))} title="Sort">
                  {l}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!shown.length && <tr><td colSpan={def.columns.length + 1} className="small muted">{def.sortKey ? 'Nothing changed after packing for these dates.' : 'No sales for these dates.'}</td></tr>}
            {shown.map((r, n) => (
              <tr key={`${id}-${n}`}>
                <td className="right soft small">{n + 1}</td>
                {def.columns.map(([k, , fmt, align]) => <td key={k} className={align || ''}>{fmt ? fmt(r[k]) : (r[k] || '-')}</td>)}
              </tr>
            ))}
          </tbody>
          {shown.length > 1 && (
            <tfoot>
              <tr>
                <th />
                {def.columns.map(([k, , fmt, align], i) => (
                  <th key={k} className={align || ''}>{i === 0 ? `Total (${shown.length})` : k in totals ? (fmt ? fmt(totals[k]) : totals[k]) : ''}</th>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function DayBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.amount));
  if (!days.length) return null;
  return (
    <section className="card card-pad mb-3">
      <h3 className="card-title">Sale per day</h3>
      <div className="an-bars" role="img" aria-label="Sale amount per day">
        {days.map((d) => (
          <div key={d.date} className="an-bar" title={`${dayLabel(d.date)}: ${formatINR(d.amount)} · ${d.orders} orders · ${num(d.dzn)} Dzn`}>
            <span className="an-bar-value">{formatINR(d.amount)}</span>
            <span className="an-bar-fill" style={{ height: `${Math.max(4, (d.amount / max) * 100)}%` }} />
            <span className="an-bar-label">{dayLabel(d.date)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Analytics() {
  const [[from, to], setRange] = useState(PRESETS[2][1]());
  const [scope, setScope] = useState('confirmed');
  const [tab, setTab] = useState('parties');
  const { data, loading, error, reload } = useAsync(() => adminApi.get(`/analytics${qs({ from, to, scope })}`), [from, to, scope]);
  const k = data?.kpi;
  const f = data?.fulfilment;
  const range = `${from} to ${to}`;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Sales by party, item, category, size, colour and team member. Only the owner sees this page." />
      <div className="filter-bar">
        {PRESETS.map(([name, r]) => {
          const [f, t] = r();
          return <button key={name} type="button" className="status-tab" aria-pressed={from === f && to === t} onClick={() => setRange([f, t])}>{name}</button>;
        })}
        <input className="input" type="date" value={from} onChange={(e) => setRange([e.target.value, to])} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => setRange([from, e.target.value])} aria-label="To date" />
        <select className="select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Which orders">
          {SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {loading && data && <Spinner small />}
      </div>
      {loading && !data ? <PageLoader /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <>
          <div className="stat-grid cols-6 mb-3">
            <Stat label="Sale amount" value={formatINR(k.amount)} icon={IndianRupee} tone="success" />
            <Stat label="Orders" value={num(k.orders)} icon={ShoppingBag} />
            <Stat label="Quantity" value={`${num(k.dzn)} Dzn`} icon={Package} />
            <Stat label="Pieces / boxes" value={`${num(k.pcs)} / ${num(k.boxes)}`} icon={Boxes} />
            <Stat label="Parties" value={num(k.parties)} icon={Users} />
            <Stat label="Avg order" value={formatINR(k.avg_order)} icon={BarChart3} />
          </div>
          <div className="stat-grid cols-6 mb-3">
            <Stat label="MRP value" value={formatINR(k.mrp)} />
            <Stat label="Discount given" value={formatINR(k.discount)} />
            <Stat label="Less packing" value={formatINR(k.packing_less)} />
            <Stat label="Avg rate / pc" value={formatINR(k.avg_rate)} />
            <Stat label="New / existing customers ₹" value={`${num(Math.round(k.new_amount))} / ${num(Math.round(k.existing_amount))}`} />
            <Stat label="Cancelled" value={`${k.cancelled_orders} · ${formatINR(k.cancelled_amount)}`} icon={XCircle} tone={k.cancelled_orders ? 'danger' : 'default'} />
          </div>
          <h3 className="card-title">Ordered vs supplied <span className="small muted">- items when the order went to packing vs what was finally given</span></h3>
          <div className="stat-grid cols-6 mb-3">
            <Stat label="Orders packed" value={num(f.packed_orders)} icon={Package} />
            <Stat label="Changed after packing" value={num(f.changed_orders)} icon={ClipboardEdit} tone={f.changed_orders ? 'warning' : 'default'} />
            <Stat label="Ordered / supplied pcs" value={`${num(f.ordered_pcs)} / ${num(f.supplied_pcs)}`} icon={Boxes} />
            <Stat label="Short / extra pcs" value={`${num(f.short_pcs)} / ${num(f.extra_pcs)}`} icon={TrendingDown} tone={f.short_pcs ? 'danger' : 'default'} />
            <Stat label="Short supplied ₹" value={formatINR(f.short_amount)} tone={f.short_amount ? 'danger' : 'default'} />
            <Stat label="Fill rate" value={f.fill_rate === null ? '-' : `${num(f.fill_rate)}%`} icon={Percent} tone={f.fill_rate !== null && f.fill_rate < 100 ? 'warning' : 'success'} />
          </div>
          <DayBars days={data.days} />
          <section className="card card-pad">
            <div className="status-tabs mb-2">
              {Object.entries(TABLES).map(([id, t]) => (
                <button key={id} type="button" className="status-tab" aria-pressed={tab === id} onClick={() => setTab(id)}>{t.label} <b>{data[id].length}</b></button>
              ))}
            </div>
            <DataTable key={tab} id={tab} rows={data[tab]} range={range} />
          </section>
        </>
      )}
    </>
  );
}
