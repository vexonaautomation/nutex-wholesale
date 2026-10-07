import {
  submitPayment, listPayments, verifyPayment, rejectPayment, getPaymentProof,
} from '../services/paymentService.js';
import { paymentSubmitSchema, formatZodError } from '../utils/validation.js';
import { badRequest } from '../utils/errors.js';
import { ctx, noStore } from './helpers.js';

// multipart/form-data: amount, utr (optional), customer_note, idempotency_key + file "screenshot"
export async function submit(req, res) {
  const parsed = paymentSubmitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const details = formatZodError(parsed.error);
    throw badRequest(details[0]?.message || 'Please check the payment details.', details);
  }
  const order = await submitPayment(req.params.orderNumber, req.orderToken, parsed.data, req.file, { ip: req.ip });
  noStore(res);
  res.status(201).json({ order });
}

export const adminList = async (req, res) => res.json(await listPayments(req.query));
export const adminVerify = async (req, res) => res.json(await verifyPayment(req.params.id, req.body, ctx(req)));
export const adminReject = async (req, res) => res.json(await rejectPayment(req.params.id, req.body, ctx(req)));

export async function adminProof(req, res) {
  const file = await getPaymentProof(req.params.id);
  res.set({
    'Content-Type': file.mimeType,
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(file.buffer);
}
