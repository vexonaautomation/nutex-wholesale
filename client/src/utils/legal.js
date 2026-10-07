import { formatINR } from './format.js';

// Default policy templates. Every company-specific value comes from Settings.
// Admins can replace any page entirely in Admin > Settings > Legal pages.
// These templates MUST be reviewed by Nutex before production use.
export const LEGAL_TEMPLATES = {
  legal_privacy_policy: `# Privacy Policy

{{company_name}} ("we", "us") operates this wholesale ordering website. This policy explains what information we collect and how we use it.

## Information we collect
- Contact and business details you provide at checkout: name, business name, mobile and WhatsApp numbers, email, billing and shipping address, city, state, pincode and GSTIN.
- Order details: products, quantities, prices and order status.
- Payment confirmation details you submit: amount, UTR / transaction ID and the payment screenshot.

We do not collect or store your card, bank or UPI PIN details. Payments are made directly through your own UPI application.

## How we use information
- To process, verify, pack, dispatch and support your wholesale orders.
- To contact you about your order by phone, WhatsApp or email.
- To maintain business records required by law (for example GST invoicing).

## Storage and security
Order and customer records are stored in access-controlled business systems (Google Workspace services). Payment screenshots are visible only to authorised staff.

## Sharing
We share information only with logistics partners for delivery, and with authorities where required by law. We do not sell personal information.

## Your choices
To update or correct your details, contact us at {{company_email}} or {{company_phone}}.

## Contact
{{company_name}}
{{company_address}}`,

  legal_terms: `# Terms & Conditions

These terms apply to all orders placed on the {{company_name}} wholesale website.

## Eligibility
This website is intended for wholesale buyers (retailers, resellers and businesses). By placing an order you confirm that you are purchasing for business purposes.

## Prices
- Product prices are shown as MRP and/or wholesale price. The final payable amount is calculated by our system at checkout and shown before you place the order.
- Discounts and discount slabs may change from time to time. The price confirmed on your order is the price you pay.

## Orders
- An order is created when you complete checkout. It can be edited until payment confirmation is submitted.
- Once payment details are submitted, the order is locked and cannot be modified by the customer.
- Orders are confirmed only after our team verifies the payment.

## Payment
Payment is made through the UPI QR code shown on the payment page. Sending a WhatsApp message does not confirm payment; our team verifies every payment manually.

## Governing law
These terms are governed by the laws of India. Disputes are subject to the jurisdiction of courts at {{jurisdiction_city}}.

## Contact
{{company_name}} · {{company_email}} · {{company_phone}}`,

  legal_wholesale_terms: `# Wholesale Terms

## Minimum order
The minimum wholesale order is **{{minimum_order_value}}**, calculated on the final payable value after discount.

## Product options
- Some products are sold colour-wise and size-wise; others are supplied as **mix-colour boxes** with assorted colours.
- Colour assortment in mix-colour boxes is decided at packing time and may vary.

## Stock
Stock is reserved when your order is created. Unpaid orders may be cancelled automatically after {{reservation_expiry_hours}} hours and the stock released.

## GST invoice
Please enter your GSTIN at checkout to receive a GST invoice.

## Support
WhatsApp: {{whatsapp_number}} · Phone: {{company_phone}}`,

  legal_shipping_policy: `# Shipping Policy

- Orders are packed after payment verification.
- Dispatch timelines depend on order size and stock availability; our team will share the expected dispatch date on WhatsApp.
- Courier name and tracking number are shared on the order tracking page once dispatched.
- Shipping charges, if any, are communicated before dispatch.
- Please check the parcel at delivery and report any damage within 48 hours with photos.

Questions: {{company_email}} · {{company_phone}}`,

  legal_cancellation_policy: `# Cancellation Policy

- Before payment confirmation is submitted, you may edit your order or simply not proceed with payment.
- After payment confirmation is submitted, the order is locked. Contact us on WhatsApp ({{whatsapp_number}}) to request a change or cancellation.
- Cancellation after dispatch is not possible.
- Approved cancellations of paid orders are refunded to the original payment account.`,

  legal_refund_policy: `# Refund / Return Policy

- Innerwear and lingerie are hygiene products and are not returnable unless they are damaged, defective or incorrectly supplied.
- Report damaged, defective or wrong items within 48 hours of delivery with photos and the order number.
- After verification, we will replace the items or issue a refund to the original payment account.
- Refunds for approved cancellations are processed after confirmation by our accounts team.

Contact: {{company_email}} · {{company_phone}} · WhatsApp {{whatsapp_number}}`,
};

export function fillTemplate(text, settings = {}) {
  const values = {
    company_name: settings.company_name || 'Nutex Apparel Limited',
    company_address: settings.company_address || '',
    company_email: settings.company_email || '',
    company_phone: settings.company_phone || '',
    whatsapp_number: settings.whatsapp_number ? `+${settings.whatsapp_number}` : '',
    jurisdiction_city: settings.jurisdiction_city || '(city to be confirmed)',
    minimum_order_value: formatINR(settings.minimum_order_value),
    reservation_expiry_hours: settings.reservation_expiry_hours || 72,
    company_gstin: settings.company_gstin || '',
  };
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (values[k] ?? ''));
}
