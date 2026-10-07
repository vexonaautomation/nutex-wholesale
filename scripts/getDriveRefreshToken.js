#!/usr/bin/env node
// Generates GOOGLE_OAUTH_REFRESH_TOKEN for Google Drive uploads into a
// PERSONAL Gmail Drive (service accounts have no storage quota of their own).
//
// 1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID
//    → Application type "Desktop app". Copy the client ID + secret into .env:
//       GOOGLE_OAUTH_CLIENT_ID=...   GOOGLE_OAUTH_CLIENT_SECRET=...
// 2. OAuth consent screen → Publishing status: "In production" (refresh tokens of
//    apps left in "Testing" expire after 7 days).
// 3. npm run drive:token   → open the printed URL, sign in as the Drive owner.
// 4. Put the printed refresh token into Render as GOOGLE_OAUTH_REFRESH_TOKEN and set
//    GOOGLE_DRIVE_AUTH=oauth.
import http from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../server/config/env.js';
import { SCOPES } from '../server/config/google.js';

const { oauthClientId: clientId, oauthClientSecret: clientSecret } = config.google;
if (!clientId || !clientSecret) {
  console.error('✗ Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/oauth2callback`;
const client = new OAuth2Client(clientId, clientSecret, redirectUri);
const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES.drive });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirectUri);
  if (u.pathname !== '/oauth2callback') {
    res.writeHead(404).end();
    return;
  }
  const code = u.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Missing code');
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Authorised. You can close this tab and return to the terminal.');
    if (!tokens.refresh_token) {
      console.error('✗ No refresh token returned. Remove the app at https://myaccount.google.com/permissions and run again.');
    } else {
      console.log('\n✓ GOOGLE_OAUTH_REFRESH_TOKEN=');
      console.log(tokens.refresh_token);
      console.log('\nStore it ONLY in .env / Render environment variables - never commit it.');
    }
  } catch (err) {
    res.writeHead(500).end('Token exchange failed');
    console.error('✗ Token exchange failed:', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this URL in your browser and sign in with the Google account that owns the Drive folder:\n');
  console.log(url);
  console.log(`\nWaiting for Google to redirect to ${redirectUri} …`);
});
