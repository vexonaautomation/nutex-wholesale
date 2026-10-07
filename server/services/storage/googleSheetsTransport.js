import { sheets as sheetsApi } from '@googleapis/sheets';
import { withRetry } from '../../utils/retry.js';
import { assertSafeRequests } from './sheetsGuard.js';

// Thin wrapper over the Google Sheets REST API. Exposes exactly three
// capabilities: read metadata, read ranges, and apply an ATOMIC batch of
// additive/targeted requests (validated by sheetsGuard).
export class GoogleSheetsTransport {
  constructor({ auth, spreadsheetId }) {
    if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID is required');
    this.kind = 'google';
    this.spreadsheetId = spreadsheetId;
    this.api = sheetsApi({ version: 'v4', auth });
  }

  async getMeta() {
    const res = await withRetry(
      () => this.api.spreadsheets.get(
        {
          spreadsheetId: this.spreadsheetId,
          fields: 'properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))',
        },
        { timeout: 30000 },
      ),
      { label: 'sheets.get' },
    );
    return {
      title: res.data.properties?.title || '',
      sheets: (res.data.sheets || []).map((s) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
        rowCount: s.properties.gridProperties?.rowCount ?? 0,
        columnCount: s.properties.gridProperties?.columnCount ?? 0,
      })),
    };
  }

  async readRanges(ranges) {
    if (!ranges.length) return [];
    const res = await withRetry(
      () => this.api.spreadsheets.values.batchGet(
        {
          spreadsheetId: this.spreadsheetId,
          ranges,
          majorDimension: 'ROWS',
          valueRenderOption: 'UNFORMATTED_VALUE',
          dateTimeRenderOption: 'FORMATTED_STRING',
        },
        { timeout: 45000 },
      ),
      { label: 'sheets.batchGet' },
    );
    const valueRanges = res.data.valueRanges || [];
    return ranges.map((_, i) => valueRanges[i]?.values || []);
  }

  // All requests are applied atomically by Google: either every request in
  // the batch succeeds or none is applied.
  async batchUpdate(requests) {
    if (!requests.length) return null;
    assertSafeRequests(requests);
    const res = await withRetry(
      () => this.api.spreadsheets.batchUpdate(
        { spreadsheetId: this.spreadsheetId, requestBody: { requests } },
        { timeout: 60000 },
      ),
      { label: 'sheets.batchUpdate', write: true },
    );
    return res.data;
  }
}
