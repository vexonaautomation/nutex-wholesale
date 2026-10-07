import { JWT, OAuth2Client } from 'google-auth-library';
import { config } from './env.js';

export const SCOPES = Object.freeze({
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  drive: ['https://www.googleapis.com/auth/drive'],
});

// Service account for Google Sheets. The spreadsheet is owned by the business
// account and shared (Editor) with the service-account email.
export function createSheetsAuth(cfg = config) {
  return new JWT({
    email: cfg.google.serviceAccountEmail,
    key: cfg.google.privateKey,
    scopes: SCOPES.sheets,
  });
}

// Google Drive auth.
//  - service_account: works with a Google Workspace Shared Drive.
//  - oauth: a personal Gmail Drive. Service accounts have no storage quota of
//    their own, so uploads into a personal "My Drive" folder must be made as
//    the real owner using an OAuth refresh token.
export function createDriveAuth(cfg = config) {
  if (cfg.google.driveAuth === 'oauth') {
    const client = new OAuth2Client(cfg.google.oauthClientId, cfg.google.oauthClientSecret);
    client.setCredentials({ refresh_token: cfg.google.oauthRefreshToken });
    return client;
  }
  return new JWT({
    email: cfg.google.serviceAccountEmail,
    key: cfg.google.privateKey,
    scopes: SCOPES.drive,
  });
}
