import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, QrCode } from 'lucide-react';
import { orderApi, listSavedOrders, saveOrderAccess, getOrderToken } from '../../services/order.js';
import { customerApi } from '../../services/customer.js';
import { useCustomer } from '../../context/CustomerContext.jsx';
import { StatusBadge } from '../common/ui.jsx';
import { DownloadBillButton } from '../DownloadBill/DownloadBillButton.jsx';
import { formatDate, formatINR } from '../../utils/format.js';

// What happens next, per order status
const NEXT_STEP = {
  PAYMENT_PENDING: 'Scan the QR code and pay to confirm this order.',
  PAYMENT_REJECTED: 'Payment could not be verified - please pay and submit again.',
  PAYMENT_SUBMITTED: 'Payment submitted - our team is verifying it.',
  PAYMENT_VERIFIED: 'Payment verified - your order will be packed soon.',
  CONFIRMED: 'Order confirmed - it will be packed soon.',
  PROCESSING: 'Your order is being prepared.',
  PACKED: 'Packed - ready for handover.',
  DISPATCHED: 'Dispatched - on its way to you.',
  COMPLETED: 'Handed over. Thank you for your order!',
  CANCELLED: 'This order was cancelled.',
};

const awaitingTeam = (o) => o.payment_mode === 'OFFLINE' && o.order_status === 'PAYMENT_PENDING';

/**
 * The customer's orders for "My orders": every order placed on this device,
 * plus - for an existing customer logged in with the WhatsApp OTP - their
 * orders from any device. Each has { group: PENDING | CONFIRMED | HISTORY }.
 */
export function useMyOrders() {
  const { isExisting, auth } = useCustomer();
  const [state, setState] = useState({ loading: true, orders: [], account: false, error: null });

  const load = useCallback(async () => {
    let account = false;
    if (isExisting) {
      try {
        const res = await customerApi.orders();
        account = res.verified === true;
        // remember them on this device so they can be opened
        for (const o of res.orders) if (!getOrderToken(o.order_number)) saveOrderAccess(o.order_number, o.token);
      } catch { /* the orders of this device still show */ }
    }
    const saved = listSavedOrders().filter((o) => o.token).slice(0, 50);
    if (!saved.length) {
      setState({ loading: false, orders: [], account, error: null });
      return;
    }
    try {
      const { orders } = await orderApi.active(saved);
      orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setState({ loading: false, orders, account, error: null });
    } catch (error) {
      setState({ loading: false, orders: [], account, error });
    }
  }, [isExisting, auth?.token]); // reload after logging in again

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export function OrderCard({ order: o }) {
  return (
    <div className={`order-card ${o.can_submit_payment ? 'is-due' : ''} ${o.group === 'HISTORY' ? 'is-closed' : ''}`}>
      <div className="order-card-top">
        <div>
          <strong className="order-card-no">{o.order_number}</strong>
          <div className="tiny soft">{formatDate(o.created_at)} · {o.lines} item{o.lines === 1 ? '' : 's'} · {o.total_pcs} pcs</div>
        </div>
        <strong className="num">{formatINR(o.final_payable)}</strong>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {awaitingTeam(o) ? <span className="badge badge-warning">Awaiting confirmation</span> : <StatusBadge status={o.order_status} />}
      </div>
      <p className="small muted mb-0">{awaitingTeam(o) ? 'Order received - our team will contact you to confirm it.' : NEXT_STEP[o.order_status] || o.status_label}</p>
      <div className="row wrap" style={{ gap: 8 }}>
        {o.can_submit_payment && (
          <Link to={`/order/${o.order_number}/payment`} className="btn btn-primary btn-sm grow"><QrCode /> Pay {formatINR(o.amount_to_pay)}</Link>
        )}
        <Link to={`/order/${o.order_number}`} className="btn btn-sm grow">View order <ArrowRight /></Link>
        {o.can_download_bill && <DownloadBillButton orderNumber={o.order_number} className="btn btn-sm grow" label="Bill" />}
      </div>
    </div>
  );
}
