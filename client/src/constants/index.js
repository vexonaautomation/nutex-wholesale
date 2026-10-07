export const ORDER_STATUS = {
  DRAFT: { label: 'Draft', tone: 'outline' },
  PAYMENT_PENDING: { label: 'Payment Pending', tone: 'warning' },
  PAYMENT_SUBMITTED: { label: 'Payment Submitted', tone: 'info' },
  PAYMENT_VERIFIED: { label: 'Payment Verified', tone: 'success' },
  PAYMENT_REJECTED: { label: 'Payment Rejected', tone: 'danger' },
  CONFIRMED: { label: 'Confirmed', tone: 'brand' },
  PROCESSING: { label: 'Processing', tone: 'brand' },
  PACKED: { label: 'Packed', tone: 'brand' },
  DISPATCHED: { label: 'Dispatched', tone: 'gold' },
  COMPLETED: { label: 'Handed over', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'dark' },
};

export const PAYMENT_STATUS = {
  PENDING: { label: 'Pending', tone: 'warning' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export const RECORD_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INACTIVE: { label: 'Inactive', tone: 'warning' },
  ARCHIVED: { label: 'Archived', tone: 'dark' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'danger' },
};

export const FULFILMENT_FLOW = ['PAYMENT_VERIFIED', 'CONFIRMED', 'PROCESSING', 'PACKED', 'DISPATCHED', 'COMPLETED'];

export const SLAB_BASIS_LABELS = {
  MRP_SUBTOTAL: 'MRP subtotal',
  PRE_DISCOUNT_WHOLESALE_SUBTOTAL: 'Wholesale subtotal (before slab)',
  FINAL_PAYABLE: 'Final payable value',
};

export const PRICE_DISPLAY_LABELS = {
  SHOW_MRP: 'Show MRP only',
  SHOW_WHOLESALE: 'Show wholesale price only',
  SHOW_BOTH: 'Show both',
};

export const POLICY_PAGES = [
  { slug: 'privacy-policy', key: 'legal_privacy_policy', title: 'Privacy Policy' },
  { slug: 'terms-and-conditions', key: 'legal_terms', title: 'Terms & Conditions' },
  { slug: 'wholesale-terms', key: 'legal_wholesale_terms', title: 'Wholesale Terms' },
  { slug: 'shipping-policy', key: 'legal_shipping_policy', title: 'Shipping Policy' },
  { slug: 'cancellation-policy', key: 'legal_cancellation_policy', title: 'Cancellation Policy' },
  { slug: 'refund-policy', key: 'legal_refund_policy', title: 'Refund / Return Policy' },
];

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];
