// Default configuration values.
//
// Settings defaults are written ONLY for keys that do not exist yet in the
// Settings sheet (additive). An existing value is never overwritten.
//
// INITIAL_MASTER_DATA is the business's real starting master data (not demo
// data). It is inserted only when an admin explicitly clicks
// "Load initial master data" (or runs `npm run setup:sheets -- --with-master-data`)
// and only into sheets that are completely empty.

import {
  DISCOUNT_MODE, PRICE_DISPLAY_MODE, SLAB_BASIS,
} from './constants.js';

export const DEFAULT_SETTINGS = [
  // ---- Company ----
  { key: 'company_name', value: 'Nutex Apparel Limited', type: 'string', public: true, description: 'Company name shown across the website' },
  { key: 'company_tagline', value: 'Wholesale innerwear & lingerie', type: 'string', public: true, description: 'Short tagline under the logo' },
  { key: 'company_logo_file_id', value: '', type: 'string', public: true, description: 'Google Drive file ID of the company logo' },
  { key: 'size_chart_file_id', value: '', type: 'string', public: true, description: 'Google Drive file ID of the bra size chart shown on product pages' },
  { key: 'company_phone', value: '', type: 'string', public: true, description: 'Customer care phone number' },
  { key: 'company_email', value: '', type: 'string', public: true, description: 'Customer care email' },
  { key: 'company_address', value: '', type: 'text', public: true, description: 'Registered / business address' },
  { key: 'company_gstin', value: '', type: 'string', public: true, description: 'Company GSTIN (shown on legal pages)' },
  { key: 'whatsapp_number', value: '', type: 'phone', public: true, description: 'Support WhatsApp number with country code, e.g. 919876543210' },
  { key: 'business_hours', value: 'Mon-Sat, 10:00 AM - 7:00 PM', type: 'string', public: true, description: 'Business hours shown on contact page' },
  { key: 'jurisdiction_city', value: '', type: 'string', public: true, description: 'City for legal jurisdiction in Terms & Conditions' },
  { key: 'support_message', value: 'For wholesale enquiries, message us on WhatsApp. Our team will help you choose products and sizes.', type: 'text', public: true, description: 'Support message shown on the website' },
  { key: 'announcement_text', value: '', type: 'string', public: true, description: 'Optional announcement bar text (blank = automatic minimum-order message)' },
  { key: 'hero_title', value: 'Wholesale innerwear, direct from Nutex', type: 'string', public: true, description: 'Homepage headline' },
  { key: 'hero_subtitle', value: 'Bras, panties, lingerie sets, camisoles and men\'s innerwear at wholesale prices for retailers and resellers.', type: 'text', public: true, description: 'Homepage sub-headline' },

  // ---- Pricing & ordering ----
  { key: 'minimum_order_value', value: 10000, type: 'number', public: true, description: 'Minimum FINAL payable (after discount) required to place an order' },
  { key: 'discount_mode', value: DISCOUNT_MODE.FIXED, type: 'enum', options: Object.values(DISCOUNT_MODE), public: true, description: 'FIXED = single discount %, SLAB = tiered discount slabs' },
  { key: 'default_discount_percent', value: 60, type: 'number', public: true, description: 'Fixed wholesale discount % (also the base for PRE_DISCOUNT_WHOLESALE_SUBTOTAL slab basis)' },
  { key: 'discount_slab_basis', value: SLAB_BASIS.MRP_SUBTOTAL, type: 'enum', options: Object.values(SLAB_BASIS), public: true, description: 'Which cart amount selects the slab' },
  { key: 'price_display_mode', value: PRICE_DISPLAY_MODE.SHOW_BOTH, type: 'enum', options: Object.values(PRICE_DISPLAY_MODE), public: true, description: 'Prices shown on product cards/pages' },
  { key: 'currency', value: 'INR', type: 'string', public: true, description: 'Currency code' },
  { key: 'order_prefix', value: 'NX', type: 'string', public: false, description: 'Prefix of customer-facing order numbers, e.g. NX-20261003-0001' },
  { key: 'low_stock_threshold', value: 5, type: 'number', public: false, description: 'Variants at or below this available quantity are flagged as low stock' },
  { key: 'reservation_expiry_hours', value: 72, type: 'number', public: true, description: 'Unpaid orders (no payment submitted) are auto-cancelled after this many hours and their stock released. 0 = never.' },

  // ---- Existing customers (listed in the Existing_Customers sheet) ----
  { key: 'existing_customer_minimum_order_value', value: 0, type: 'number', public: true, description: 'Minimum order for verified existing customers (0 = no minimum). A value in the Existing_Customers sheet overrides this per customer.' },
  { key: 'existing_customer_otp_enabled', value: true, type: 'boolean', public: true, description: 'Verify existing customers with a WhatsApp OTP (recommended). If off, the mobile number alone is enough.' },
  { key: 'pcs_for_existing_customers_only', value: true, type: 'boolean', public: true, description: 'TRUE = new customers buy full boxes; loose pieces only where the product allows it (Products > pieces for new customers). FALSE = loose pieces for everyone on every product. Existing customers always choose box or pieces.' },
  { key: 'auto_existing_after_first_order', value: true, type: 'boolean', public: false, description: 'When the first payment of a new customer is verified, add their mobile to Existing_Customers automatically (pieces allowed and no minimum order from then on).' },
  { key: 'otp_message_template', value: '{{otp}} is your {{company_name}} verification code. It is valid for 5 minutes. Do not share this code with anyone.', type: 'text', public: false, description: 'WhatsApp OTP message. {{otp}} and {{company_name}} are replaced automatically.' },

  // ---- Payment ----
  { key: 'payment_qr_file_id', value: '', type: 'string', public: true, description: 'Google Drive file ID of the payment QR uploaded by admin' },
  { key: 'upi_id', value: '', type: 'string', public: true, description: 'Company UPI ID' },
  { key: 'payment_name', value: '', type: 'string', public: true, description: 'Account / payee name shown with the QR' },
  { key: 'payment_instructions', value: '1. Scan the QR code with any UPI app (GPay, PhonePe, Paytm, BHIM).\n2. Pay the exact order amount.\n3. Note the UTR / Transaction ID.\n4. Submit the UTR and payment screenshot below.', type: 'text', public: true, description: 'Instructions shown on the payment page' },
  { key: 'payment_whatsapp_number', value: '', type: 'phone', public: true, description: 'WhatsApp number for payment confirmation (falls back to support number)' },

  // ---- Legal (blank = built-in template, review before production) ----
  { key: 'legal_privacy_policy', value: '', type: 'text', public: true, description: 'Privacy Policy (blank = default template)' },
  { key: 'legal_terms', value: '', type: 'text', public: true, description: 'Terms & Conditions (blank = default template)' },
  { key: 'legal_wholesale_terms', value: '', type: 'text', public: true, description: 'Wholesale Terms (blank = default template)' },
  { key: 'legal_shipping_policy', value: '', type: 'text', public: true, description: 'Shipping Policy (blank = default template)' },
  { key: 'legal_cancellation_policy', value: '', type: 'text', public: true, description: 'Cancellation Policy (blank = default template)' },
  { key: 'legal_refund_policy', value: '', type: 'text', public: true, description: 'Refund / Return Policy (blank = default template)' },
];

export const SETTINGS_BY_KEY = Object.fromEntries(DEFAULT_SETTINGS.map((s) => [s.key, s]));

export const INITIAL_MASTER_DATA = {
  categories: [
    { category_name: '1 Set / Lingerie Set', parent_category: 'WOMEN', slug: 'lingerie-set' },
    { category_name: 'Padded Bra', parent_category: 'WOMEN', slug: 'padded-bra' },
    { category_name: 'Sports Bra', parent_category: 'WOMEN', slug: 'sports-bra' },
    { category_name: 'T-Shirt Bra', parent_category: 'WOMEN', slug: 't-shirt-bra' },
    { category_name: 'Everyday Bra Collection', parent_category: 'WOMEN', slug: 'everyday-bra' },
    { category_name: 'Print Collection', parent_category: 'WOMEN', slug: 'print-collection' },
    { category_name: 'Cotton Collection', parent_category: 'WOMEN', slug: 'cotton-collection' },
    { category_name: 'Camisole Collection', parent_category: 'WOMEN', slug: 'camisole-collection' },
    { category_name: 'Everyday Panty Collection', parent_category: 'PANTIES', slug: 'everyday-panty' },
    { category_name: 'Men Collection', parent_category: 'MEN', slug: 'men-collection' },
  ],
  sizes: ['28', '30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54', '56', 'Free Size'],
  colors: [
    { color_name: 'Black', color_code: 'BLK', hex_code: '#111111' },
    { color_name: 'White', color_code: 'WHT', hex_code: '#FFFFFF' },
    { color_name: 'Skin', color_code: 'SKN', hex_code: '#E8C4A8' },
    { color_name: 'Pink', color_code: 'PNK', hex_code: '#F4A7B9' },
    { color_name: 'Red', color_code: 'RED', hex_code: '#C62828' },
    { color_name: 'Maroon', color_code: 'MRN', hex_code: '#6D1B2E' },
    { color_name: 'Navy Blue', color_code: 'NVY', hex_code: '#1F2A56' },
    { color_name: 'Grey', color_code: 'GRY', hex_code: '#9AA0A6' },
  ],
};
