import { badRequest } from '../utils/errors.js';
import { formatZodError } from '../utils/validation.js';

/**
 * Validates req.body (default) or req.query with a zod schema.
 * Validated body replaces req.body; validated query is put on req.validQuery
 * (Express 5 makes req.query read-only).
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(source === 'query' ? req.query : req.body ?? {});
    if (!result.success) {
      const details = formatZodError(result.error);
      return next(badRequest(details[0]?.message || 'Please check the highlighted fields.', details));
    }
    if (source === 'query') req.validQuery = result.data;
    else req.body = result.data;
    return next();
  };
}
