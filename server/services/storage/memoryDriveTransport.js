import { randomBytes } from 'node:crypto';

// In-memory Drive used by tests / local experiments only (refused in production).
export class MemoryDriveTransport {
  constructor({ rootFolderId = 'memory-root' } = {}) {
    this.kind = 'memory';
    this.rootFolderId = rootFolderId;
    this.files = new Map();
    this.files.set(rootFolderId, { id: rootFolderId, name: 'NUTEX WHOLESALE', folder: true, parent: null });
  }

  async listChildFolders(parentId) {
    return [...this.files.values()].filter((f) => f.folder && f.parent === parentId).map(({ id, name }) => ({ id, name }));
  }

  async createFolder(name, parentId) {
    const id = `fld_${randomBytes(6).toString('hex')}`;
    this.files.set(id, { id, name, folder: true, parent: parentId });
    return { id, name };
  }

  async verifyRoot() {
    return this.files.get(this.rootFolderId);
  }

  async upload({ buffer, mimeType, name, parentId }) {
    const id = `file_${randomBytes(8).toString('hex')}`;
    this.files.set(id, { id, name, mimeType, buffer, parent: parentId });
    return { id, name, mimeType, size: buffer.length, webViewLink: `memory://drive/${id}` };
  }

  async download(fileId) {
    const f = this.files.get(fileId);
    if (!f || f.folder) throw Object.assign(new Error('File not found'), { status: 404 });
    return { buffer: f.buffer, mimeType: f.mimeType };
  }
}
