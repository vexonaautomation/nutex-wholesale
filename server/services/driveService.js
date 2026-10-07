import { DRIVE_FOLDERS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { serviceUnavailable } from '../utils/errors.js';

// Persistent file storage (product/category images, QR, logo, payment proofs).
// Sheets store only the Drive file ID + link; Render's disk is never used.
class DriveService {
  constructor() {
    this.transport = null;
    this.folders = {};
    this.ready = false;
  }

  configure({ transport }) {
    this.transport = transport;
    this.folders = {};
    this.ready = false;
  }

  get enabled() {
    return Boolean(this.transport);
  }

  // Creates any MISSING sub-folder under the root. Existing folders are reused.
  async ensureFolders() {
    if (!this.transport) return {};
    await this.transport.verifyRoot();
    const existing = await this.transport.listChildFolders(this.transport.rootFolderId);
    const byName = new Map(existing.map((f) => [f.name, f.id]));
    for (const name of Object.values(DRIVE_FOLDERS)) {
      if (!byName.has(name)) {
        const created = await this.transport.createFolder(name, this.transport.rootFolderId);
        byName.set(name, created.id);
        logger.info(`Drive: created folder ${name}`);
      }
      this.folders[name] = byName.get(name);
    }
    this.ready = true;
    return { ...this.folders };
  }

  async upload({ buffer, mimeType, filename, folder }) {
    if (!this.transport) {
      throw serviceUnavailable('File uploads are not configured. Please contact support.', 'UPLOADS_DISABLED');
    }
    if (!this.ready) await this.ensureFolders();
    const parentId = this.folders[folder] || this.transport.rootFolderId;
    const file = await this.transport.upload({ buffer, mimeType, name: filename, parentId });
    return {
      file_id: file.id,
      file_url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      name: file.name,
      mime_type: mimeType,
      size: buffer.length,
    };
  }

  async download(fileId) {
    if (!this.transport) throw serviceUnavailable('File storage is not configured.', 'UPLOADS_DISABLED');
    return this.transport.download(fileId);
  }
}

export const driveService = new DriveService();
