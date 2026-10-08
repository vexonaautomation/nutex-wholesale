import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { orderApi } from '../../services/order.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner } from '../common/ui.jsx';

// Downloads the order bill PDF (available once the payment is submitted).
export function DownloadBillButton({ orderNumber, className = 'btn', label = 'Download bill' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await orderApi.bill(orderNumber);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      toast.error(err.message || 'Could not download the bill. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={className} onClick={download} disabled={busy}>
      {busy ? <Spinner small /> : <FileDown />} {label}
    </button>
  );
}
