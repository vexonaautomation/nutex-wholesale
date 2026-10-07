import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { AppError, serviceUnavailable } from '../utils/errors.js';

/**
 * Outbound WhatsApp messages (currently: OTP codes).
 *
 * Providers
 *  - cloudwhatsapp: POST form fields apikey / mobile / msg to WHATSAPP_API_URL
 *      response: {"status":"OK"|"ERROR","errormsg":"…","statuscode":200|400,"requestid":…}
 *  - console: DEVELOPMENT ONLY - message is printed to the server log
 *
 * The API key is never logged.
 */
export function whatsappConfigured(cfg = config) {
  return Boolean(cfg.whatsapp.provider);
}

function formatMobile(mobile10, cfg) {
  return `${cfg.whatsapp.mobilePrefix || ''}${mobile10}`;
}

export function interpretProviderResponse(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Unexpected response from WhatsApp provider' };
  const status = String(body.status || '').toUpperCase();
  const code = Number(body.statuscode);
  const failed = status === 'ERROR' || status === 'FAILED' || (Number.isFinite(code) && code >= 400);
  if (failed) return { ok: false, error: body.errormsg || body.message || 'WhatsApp provider rejected the message' };
  return { ok: true, requestId: body.requestid ?? null, cost: body.msgcost ?? null };
}

export async function sendWhatsAppText(mobile10, message, { cfg = config, fetchImpl = globalThis.fetch } = {}) {
  const provider = cfg.whatsapp.provider;
  if (!provider) throw serviceUnavailable('WhatsApp verification is not available right now. Please contact us on WhatsApp.', 'WHATSAPP_NOT_CONFIGURED');

  if (provider === 'console') {
    if (cfg.isProd) throw serviceUnavailable('WhatsApp provider misconfigured.', 'WHATSAPP_NOT_CONFIGURED');
    logger.warn(`[DEV WhatsApp → ${formatMobile(mobile10, cfg)}] ${message}`);
    return { ok: true, requestId: 'console' };
  }

  if (provider === 'cloudwhatsapp') {
    const body = new URLSearchParams({ apikey: cfg.whatsapp.apiKey, mobile: formatMobile(mobile10, cfg), msg: message });
    let res;
    try {
      res = await fetchImpl(cfg.whatsapp.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      logger.error('WhatsApp API unreachable', { error: err.message });
      throw new AppError(502, 'OTP_SEND_FAILED', 'We could not send the WhatsApp code right now. Please try again in a minute.');
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const result = interpretProviderResponse(json || { status: res.ok ? 'OK' : 'ERROR', statuscode: res.status });
    if (!result.ok) {
      logger.error('WhatsApp API rejected OTP message', { error: result.error, http: res.status });
      throw new AppError(502, 'OTP_SEND_FAILED', 'We could not send the WhatsApp code to this number. Please check the number or contact us on WhatsApp.');
    }
    return result;
  }

  throw serviceUnavailable(`Unknown WhatsApp provider "${provider}".`, 'WHATSAPP_NOT_CONFIGURED');
}
