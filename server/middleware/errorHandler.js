import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { errorStatus } from '../utils/retry.js';

export function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
}

// Customers get friendly messages; technical details stay in server logs.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(`${req.method} ${req.originalUrl} -> ${err.code}`, err);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (maximum 8 MB).' : 'File upload failed. Please try again.';
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid request.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' } });
  }
  const upstream = errorStatus(err);
  logger.error(`${req.method} ${req.originalUrl} failed`, err);
  if (upstream === 429) {
    return res.status(503).json({ error: { code: 'BUSY', message: 'We are receiving many requests right now. Please try again in a minute.' } });
  }
  const isPayment = /\/payment$/.test(req.path);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isPayment ? 'Your payment details could not be submitted. Please try again.' : 'Something went wrong. Please try again.',
    },
  });
}
