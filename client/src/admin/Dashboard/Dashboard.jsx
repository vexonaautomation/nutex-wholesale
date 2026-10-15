import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BadgePercent, Boxes, CheckCircle2, ClipboardList, Clock, CreditCard, FolderTree, Hourglass, IndianRupee, PackageX, Shirt, Target, Truck, UserRound, Users, XCircle,
} from 'lucide-react';
import { adminApi } from '../../services/auth.js';
import { useAsync } from '../../hooks/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader, Stat } from '../components.jsx';
import { Alert, ErrorState, PageLoader, StatusBadge, Spinner } from '../../components/common/ui.jsx';
import { formatDateTime, formatINR, pct } from '../../utils/format.js';
import { SLAB_BASIS_LABELS, PRICE_DISPLAY_LABELS } from '../../constants/index.js';
import { PaymentQrButton } from '../PaymentQrManager.jsx';
import { useAdmin } from '../AdminApp.jsx';
import { MadeBy } from '../Orders/OrderList.jsx';

/** Pending orders + sale value cards (owner and sub admins). */
function SalesCards({ s }) {
  return (
    <div className="stat-grid cols-6 mb-3">
      <Stat label="Pending orders" value={s.pending_orders} icon={Hourglass} tone={s.pending_orders ? 'warning' : 'default'} to="/admin/orders" />
      <Stat label="Payment to verify" value={s.payment_to_verify} icon={CreditCard} tone={s.payment_to_verify ? 'info' : 'default'} to="/admin/orders?status=PAYMENT_SUBMITTED" />
      <Stat label="To pack / dispatch" value={s.to_dispatch} icon={Truck} />
      <Stat label="Sale value today" value={formatINR(s.sale_value_today)} icon={IndianRupee} tone="success" />
      <Stat label="Sale value this month" value={formatINR(s.sale_value_month)} icon={IndianRupee} tone="success" />
      <Stat label="Total sale value" value={formatINR(s.sale_value_total)} icon={IndianRupee} />
    </div>
  );
}

function RecentOrders({ title, orders, empty = 'No orders yet' }) {
  const navigate = useNavigate();
  return (
    <section className="card card-pad">
      <div className="row-between mb-2"><h3 className="card-title mb-0">{title}</h3><Link to="/admin/orders" className="btn btn-sm">All orders</Link></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Order</th><th>Customer</th><th className="right">Value</th><th>Status</th><th>Made by</th></tr></thead>
          <tbody>
            {orders.length ? orders.map((o) => (
              <tr key={o.order_id} className="is-clickable" onClick={() => navigate(`/admin/orders/${o.order_id}`)}>
                <td><div className="cell-main">{o.order_number}</div><div className="cell-sub">{formatDateTime(o.created_at)}</div></td>
                <td><div className="cell-main">{o.business_name}</div><div className="cell-sub">{o.customer_name}</div></td>
                <td className="right num">{formatINR(o.final_payable)}</td>
                <td><StatusBadge status={o.order_status} /></td>
                <td><MadeBy order={o} /></td>
              </tr>
            )) : <tr><td colSpan={5} className="center muted">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Sub admin: only pending orders and sale value (all orders + their own). */
function SubAdminDashboard({ data, reload }) {
  const { admin } = useAdmin();
  const m = data.mine;
  return (
    <>
      <PageHeader title={`Namaste, ${admin?.name || ''}`} subtitle="Pending orders and sale value" actions={<button type="button" className="btn" onClick={reload}>Refresh</button>} />
      <SalesCards s={data.sales} />
      <section className="card card-pad mb-3">
        <h3 className="card-title"><UserRound /> Orders made with your number {admin?.mobile ? `(${admin.mobile})` : ''}</h3>
        <div className="stat-grid">
          <Stat label="Your orders" value={m.orders} icon={ClipboardList} to={admin?.mobile ? `/admin/orders?placed_by=${admin.mobile}` : undefined} />
          <Stat label="Your pending orders" value={m.pending_orders} icon={Hourglass} tone={m.pending_orders ? 'warning' : 'default'} />
          <Stat label="Your sale value (month)" value={formatINR(m.sale_value_month)} icon={IndianRupee} tone="success" />
          <Stat label="Your total sale value" value={formatINR(m.sale_value_total)} icon={IndianRupee} />
        </div>
      </section>
      <div className="adm-grid-main">
        <RecentOrders title="Recent orders" orders={data.recent_orders} />
        <RecentOrders title="Your recent orders" orders={data.my_recent_orders} empty="No orders made with your number yet" />
      </div>
    </>
  );
}

/** Owner: orders made by each sub admin / admin number. */
function TeamOrders({ team }) {
  if (!team?.length) return null;
  return (
    <section className="card card-pad mb-3">
      <div className="row-between mb-2"><h3 className="card-title mb-0"><Users /> Orders by your team</h3><Link to="/admin/sub-admins" className="btn btn-sm">Sub admins</Link></div>
      <div className="table-wrap">
        <table className="table team-table">
          <thead><tr><th>Made by</th><th className="right">Orders</th><th className="right">Pending</th><th className="right">Sale value (month)</th><th className="right">Total sale value</th></tr></thead>
          <tbody>
            {team.map((t) => (
              <tr key={t.mobile}>
                <td><Link className="link cell-main" to={`/admin/orders?placed_by=${t.mobile}`}>{t.name}</Link><div className="cell-sub">{t.mobile}{t.sub_admin ? ' · sub admin' : ''}</div></td>
                <td className="right num">{t.orders}</td>
                <td className="right num">{t.pending_orders}</td>
                <td className="right num">{formatINR(t.sale_value_month)}</td>
                <td className="right num"><strong>{formatINR(t.sale_value_total)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { data, loading, error, reload } = useAsync(() => adminApi.get('/dashboard'), []);
  const toast = useToast();
  const navigate = useNavigate();
  const [seeding, setSeeding] = useState(false);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (data.limited) return <SubAdminDashboard data={data} reload={reload} />;
  const c = data.cards;
  const setup = data.setup;
  const needsMaster = setup.categories_empty || setup.sizes_empty || setup.colors_empty;
  const needsCatalog = !c.total_products;

  const loadMaster = async () => {
    setSeeding(true);
    try {
      const r = await adminApi.post('/setup/initial-master-data');
      toast.success(`Loaded ${r.categories} categories, ${r.sizes} sizes, ${r.colors} colors.`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live overview from Google Sheets" actions={<><PaymentQrButton onSaved={reload} /><Link to="/admin/products/new" className="btn btn-primary">Add product</Link></>} />

      {(needsMaster || needsCatalog || setup.payment_qr_missing || setup.whatsapp_missing) && (
        <div className="card card-pad mb-3">
          <h3 className="card-title"><AlertTriangle /> Setup checklist</h3>
          <div className="stack" style={{ gap: 8 }}>
            {needsMaster && (
              <Alert type="info">
                <div className="row-between wrap">
                  <span>Your category, size or color master is empty. Load Nutex's initial master data (10 categories, sizes 28–56 + Free Size, 8 basic colors). Only empty sheets are filled - nothing existing is changed.</span>
                  <button type="button" className="btn btn-sm btn-primary" onClick={loadMaster} disabled={seeding}>{seeding && <Spinner small />} Load initial master data</button>
                </div>
              </Alert>
            )}
            {needsCatalog && (
              <Alert type="info">
                <div className="row-between wrap">
                  <span>No products yet. Import the Nutex PDF catalogue - 150 products, each with its own image, colours, sizes and MRP.</span>
                  <Link to="/admin/catalog-import" className="btn btn-sm btn-primary">Import Nutex catalogue</Link>
                </div>
              </Alert>
            )}
            {setup.payment_qr_missing && (
              <Alert type="warning">
                <div className="row-between wrap">
                  <span>Payment QR is not uploaded - customers currently see a <strong>DEMO QR</strong> and cannot pay.</span>
                  <PaymentQrButton className="btn btn-sm btn-primary" label="Upload payment QR" onSaved={reload} />
                </div>
              </Alert>
            )}
            {setup.whatsapp_missing && <Alert type="warning">WhatsApp number is not set. Add it in <Link className="link" to="/admin/settings">Settings → Company</Link>.</Alert>}
          </div>
        </div>
      )}

      <SalesCards s={data.sales} />
      <TeamOrders team={data.team} />

      <div className="stat-grid cols-6 mb-3">
        <Stat label="Total products" value={c.total_products} icon={Shirt} />
        <Stat label="Active products" value={c.active_products} icon={CheckCircle2} tone="success" />
        <Stat label="Out of stock" value={c.out_of_stock_products} icon={PackageX} tone={c.out_of_stock_products ? 'danger' : 'default'} />
        <Stat label="Categories" value={c.categories} icon={FolderTree} />
        <Stat label="Customers" value={c.customers} icon={Users} />
        <Stat label="Total orders" value={c.total_orders} icon={ClipboardList} />
        <Stat label="Payment pending" value={c.payment_pending} icon={Clock} tone="warning" />
        <Stat label="Payment submitted" value={c.payment_submitted} icon={CreditCard} tone="info" />
        <Stat label="Payment verified" value={c.payment_verified} icon={CheckCircle2} tone="success" />
        <Stat label="Payment rejected" value={c.payment_rejected} icon={XCircle} tone={c.payment_rejected ? 'danger' : 'default'} />
        <Stat label="Verified order value" value={formatINR(c.verified_order_value)} icon={IndianRupee} tone="success" />
        <Stat label="Wholesale order value" value={formatINR(c.wholesale_order_value)} icon={IndianRupee} />
      </div>

      <div className="stat-grid mb-3">
        <Stat label="Confirmed" value={c.confirmed} />
        <Stat label="Processing" value={c.processing} />
        <Stat label="Packed" value={c.packed} />
        <Stat label="Dispatched" value={c.dispatched} />
        <Stat label="Handed over" value={c.completed} tone="success" />
        <Stat label="Cancelled" value={c.cancelled} />
        <Stat label="Low stock variants" value={c.low_stock_variants} icon={AlertTriangle} tone={c.low_stock_variants ? 'warning' : 'default'} />
        <Stat label="Out-of-stock variants" value={c.out_of_stock_variants} icon={Boxes} tone={c.out_of_stock_variants ? 'danger' : 'default'} />
      </div>

      <div className="adm-grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad">
            <div className="row-between mb-2"><h3 className="card-title mb-0">Recent orders</h3><Link to="/admin/orders" className="btn btn-sm">All orders</Link></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Order</th><th>Customer</th><th className="right">Value</th><th>Status</th><th>Payment</th></tr></thead>
                <tbody>
                  {data.recent_orders.length ? data.recent_orders.map((o) => (
                    <tr key={o.order_id} className="is-clickable" onClick={() => navigate(`/admin/orders/${o.order_id}`)}>
                      <td><div className="cell-main">{o.order_number}</div><div className="cell-sub">{formatDateTime(o.created_at)}</div></td>
                      <td><div className="cell-main">{o.business_name}</div><div className="cell-sub">{o.customer_name}</div></td>
                      <td className="right num">{formatINR(o.final_payable)}</td>
                      <td><StatusBadge status={o.order_status} /></td>
                      <td><StatusBadge kind="payment" status={o.payment_status} /></td>
                    </tr>
                  )) : <tr><td colSpan={5} className="center muted">No orders yet</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card card-pad">
            <div className="row-between mb-2"><h3 className="card-title mb-0">Recent payments</h3><Link to="/admin/payments" className="btn btn-sm">All payments</Link></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Order</th><th>UTR</th><th className="right">Amount</th><th>Status</th><th>Submitted</th></tr></thead>
                <tbody>
                  {data.recent_payments.length ? data.recent_payments.map((p) => (
                    <tr key={p.payment_id} className="is-clickable" onClick={() => navigate(`/admin/orders/${p.order_id}`)}>
                      <td className="cell-main">{p.order_number}</td>
                      <td className="num">{p.utr || '—'}</td>
                      <td className="right num">{formatINR(p.amount)}</td>
                      <td><StatusBadge kind="payment" status={p.status} /></td>
                      <td className="small">{formatDateTime(p.submitted_at)}</td>
                    </tr>
                  )) : <tr><td colSpan={5} className="center muted">No payments yet</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <section className="card card-pad">
            <h3 className="card-title"><BadgePercent /> Pricing configuration</h3>
            <dl className="kv">
              <dt>Discount mode</dt><dd>{data.pricing.discount_mode === 'SLAB' ? `Slab (${data.pricing.active_slabs} active slabs)` : `Fixed ${pct(data.pricing.default_discount_percent)}`}</dd>
              {data.pricing.discount_mode === 'SLAB' && <><dt>Slab basis</dt><dd>{SLAB_BASIS_LABELS[data.pricing.discount_slab_basis]}</dd></>}
              <dt>Minimum order</dt><dd><Target size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> {formatINR(data.pricing.minimum_order_value)} (final payable)</dd>
              <dt>Price display</dt><dd>{PRICE_DISPLAY_LABELS[data.pricing.price_display_mode]}</dd>
              <dt>Existing customers</dt>
              <dd>
                {data.pricing.existing_customers} listed · minimum {Number(data.pricing.existing_customer_minimum_order_value) ? formatINR(data.pricing.existing_customer_minimum_order_value) : 'none'}
                {' '}· OTP {data.pricing.existing_customer_otp_enabled ? 'on' : 'off'}
              </dd>
            </dl>
            <div className="row mt-2 wrap"><Link to="/admin/settings" className="btn btn-sm">Settings</Link><Link to="/admin/discount-slabs" className="btn btn-sm">Discount slabs</Link><Link to="/admin/existing-customers" className="btn btn-sm">Existing customers</Link></div>
          </section>
          <section className="card card-pad">
            <div className="row-between mb-1"><h3 className="card-title mb-0"><AlertTriangle /> Inventory alerts</h3><Link to="/admin/inventory" className="btn btn-sm">Inventory</Link></div>
            {[...data.out_of_stock.map((r) => ({ ...r, kind: 'out' })), ...data.low_stock.map((r) => ({ ...r, kind: 'low' }))].slice(0, 14).map((r) => (
              <div key={`${r.kind}-${r.inventory_id}`} className="summary-row">
                <span><strong style={{ color: 'var(--ink-900)' }}>{r.product_name}</strong><br /><span className="tiny">{[r.color, r.size && `Size ${r.size}`, r.box].filter(Boolean).join(' · ')}</span></span>
                <span className={`badge ${r.kind === 'out' ? 'badge-danger' : 'badge-warning'}`}>{r.kind === 'out' ? 'Out' : `${r.available} left`}</span>
              </div>
            ))}
            {!data.out_of_stock.length && !data.low_stock.length && <p className="small muted mb-0">No stock alerts.</p>}
          </section>
        </div>
      </div>
    </>
  );
}
