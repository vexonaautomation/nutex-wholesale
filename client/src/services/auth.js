import { request } from './api.js';

// Admin API client. The session lives in an httpOnly cookie (not readable
// here). The custom header proves the request comes from our own UI.
const ADMIN_HEADERS = { 'X-Requested-With': 'NutexAdmin' };

async function adminRequest(method, url, opts = {}) {
  try {
    return await request(method, `/api/admin${url}`, { ...opts, headers: { ...ADMIN_HEADERS, ...(opts.headers || {}) } });
  } catch (err) {
    if (err.status === 401 && url !== '/login' && url !== '/me') {
      window.dispatchEvent(new CustomEvent('nutex:admin-unauthorized'));
    }
    throw err;
  }
}

export const adminApi = {
  get: (url, opts) => adminRequest('GET', url, opts),
  post: (url, body, opts) => adminRequest('POST', url, { ...opts, body }),
  put: (url, body, opts) => adminRequest('PUT', url, { ...opts, body }),
  del: (url, opts) => adminRequest('DELETE', url, opts),
  upload: (url, form) => adminRequest('POST', url, { form }),
};

export const authApi = {
  login: (email, password) => adminApi.post('/login', { email, password }),
  logout: () => adminApi.post('/logout'),
  me: () => adminApi.get('/me'),
  changePassword: (current_password, new_password) => adminApi.post('/change-password', { current_password, new_password }),
};

export async function uploadImage(file, purpose) {
  const form = new FormData();
  form.set('purpose', purpose);
  form.set('file', file, file.name || 'image.jpg');
  return adminApi.upload('/uploads', form);
}
