import { Readable } from 'node:stream';
import { drive as driveApi } from '@googleapis/drive';
import { withRetry } from '../../utils/retry.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  return headers[name] || headers[name.toLowerCase()] || '';
}

// Google Drive file storage. Files are only ever CREATED here - this layer has
// no delete/trash/overwrite capability, so stored images and payment proofs
// cannot be destroyed by application code.
export class GoogleDriveTransport {
  constructor({ auth, rootFolderId }) {
    this.kind = 'google';
    this.rootFolderId = rootFolderId;
    this.api = driveApi({ version: 'v3', auth });
  }

  async listChildFolders(parentId) {
    const res = await withRetry(() => this.api.files.list({
      q: `'${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id,name)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }), { label: 'drive.list' });
    return res.data.files || [];
  }

  async createFolder(name, parentId) {
    const res = await withRetry(() => this.api.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: 'id,name',
      supportsAllDrives: true,
    }), { label: 'drive.createFolder', write: true });
    return res.data;
  }

  async verifyRoot() {
    const res = await withRetry(() => this.api.files.get({
      fileId: this.rootFolderId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    }), { label: 'drive.getRoot' });
    return res.data;
  }

  async upload({ buffer, mimeType, name, parentId }) {
    const res = await withRetry(() => this.api.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,mimeType,size,webViewLink',
      supportsAllDrives: true,
    }), { label: 'drive.upload', write: true });
    return res.data;
  }

  async download(fileId) {
    const res = await withRetry(() => this.api.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer', timeout: 30000 },
    ), { label: 'drive.download' });
    return {
      buffer: Buffer.from(res.data),
      mimeType: headerValue(res.headers, 'content-type') || 'application/octet-stream',
    };
  }
}
