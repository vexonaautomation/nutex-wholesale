import { formatINR } from './format.js';

export function waNumber(settings, purpose = 'support') {
  const raw = purpose === 'payment'
    ? settings?.payment_whatsapp_number || settings?.whatsapp_number
    : settings?.whatsapp_number || settings?.payment_whatsapp_number;
  return String(raw || '').replace(/\D/g, '');
}

export function waLink(number, text) {
  if (!number) return '';
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

// Opening WhatsApp does NOT verify a payment - admins verify it in the panel.
export function paymentConfirmationMessage({ orderNumber, amount, utr, businessName }) {
  return [
    'Hello Nutex Team,',
    `I have made payment for Order No: ${orderNumber}`,
    `Payment Amount: ${formatINR(amount)}`,
    `UTR/Transaction ID: ${utr || '-'}`,
    businessName ? `Business: ${businessName}` : null,
    'Please verify my payment.',
  ].filter(Boolean).join('\n');
}
