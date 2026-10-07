import { listCustomers, getCustomer } from '../services/customerService.js';
import {
  startVerification, confirmVerification, customerStatus, startAlternate, confirmAlternate,
} from '../services/customerVerificationService.js';
import {
  listExistingCustomers, addExistingCustomers, parseBulkText, updateExistingCustomer,
} from '../services/existingCustomerService.js';
import { badRequest } from '../utils/errors.js';
import { ctx, noStore } from './helpers.js';

// ------------------------------ public ------------------------------
export async function verifyStart(req, res) {
  noStore(res);
  res.json(await startVerification(req.body.mobile, { ip: req.ip }));
}

export async function verifyConfirm(req, res) {
  noStore(res);
  res.json(await confirmVerification(req.body.mobile, req.body.otp, { ip: req.ip }));
}

export async function status(req, res) {
  noStore(res);
  res.json(await customerStatus(req.customerToken));
}

export async function alternateStart(req, res) {
  noStore(res);
  res.json(await startAlternate(req.customerToken, req.body.mobile, { ip: req.ip }));
}

export async function alternateConfirm(req, res) {
  noStore(res);
  res.json(await confirmAlternate(req.customerToken, req.body.mobile, req.body.otp, { ip: req.ip }));
}

// ------------------------------ admin -------------------------------
export const adminList = async (req, res) => res.json({ items: await listCustomers(req.query) });
export const adminGet = async (req, res) => res.json(await getCustomer(req.params.id));

export const existingList = async (req, res) => res.json(await listExistingCustomers(req.query));

export async function existingAdd(req, res) {
  const result = await addExistingCustomers([req.body], ctx(req));
  if (!result.added && result.skipped[0]?.reason !== 'Already listed - reactivated') {
    throw badRequest(result.skipped[0]?.reason || 'Could not add this customer.');
  }
  res.status(201).json(result);
}

export async function existingBulk(req, res) {
  const rows = [...req.body.rows, ...parseBulkText(req.body.text)];
  if (!rows.length) throw badRequest('Paste at least one mobile number.');
  res.json(await addExistingCustomers(rows, ctx(req)));
}

export const existingUpdate = async (req, res) => res.json(await updateExistingCustomer(req.params.key, req.body, ctx(req)));
