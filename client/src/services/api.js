export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Thin fetch wrapper. The browser never talks to Google directly - every
 * read/write goes through the Express API, which validates and recalculates.
 */
export async function request(method, url, { body, form, headers = {}, signal } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, credentials: 'same-origin', signal };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Network error. Please check your internet connection and try again.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Something went wrong. Please try again.', e.details);
  }
  return data;
}

export const api = {
  get: (url, opts) => request('GET', url, opts),
  post: (url, body, opts) => request('POST', url, { ...opts, body }),
  put: (url, body, opts) => request('PUT', url, { ...opts, body }),
  del: (url, opts) => request('DELETE', url, opts),
  upload: (url, form, opts) => request('POST', url, { ...opts, form }),
};

export const qs = (params = {}) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
};
