// Local demo WITHOUT Google credentials: in-memory storage + demo catalogue.
// Data lives only in this process and is lost on restart. Refused in production.
//   npm run build && npm run demo   -> http://localhost:4000
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to start the in-memory demo with NODE_ENV=production.');
  process.exit(1);
}
process.env.DATA_BACKEND = 'memory';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '4000';
await import('../server/server.js');
