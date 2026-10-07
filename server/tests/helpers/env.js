// Must be imported FIRST by every test file (before any server module).
process.env.NODE_ENV = 'test';
process.env.DATA_BACKEND = 'memory';
process.env.LOG_LEVEL = 'silent';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.ADMIN_BOOTSTRAP_EMAIL = '';
process.env.ADMIN_BOOTSTRAP_PASSWORD = '';
// Tests must NEVER send real WhatsApp messages, even if .env has an API key.
process.env.WHATSAPP_PROVIDER = 'console';
process.env.WHATSAPP_API_URL = '';
process.env.WHATSAPP_API_KEY = '';
