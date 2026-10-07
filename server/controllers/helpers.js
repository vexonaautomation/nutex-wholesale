export const ctx = (req) => ({ admin: req.admin, ip: req.ip });

export const noStore = (res) => res.set('Cache-Control', 'no-store');
