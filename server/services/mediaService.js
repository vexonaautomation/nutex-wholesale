import { driveService } from './driveService.js';
import { getCatalog, publicFileIds } from './catalogService.js';
import { notFound } from '../utils/errors.js';

// Small in-memory LRU for public images streamed from Google Drive.
// It is only a performance cache - the permanent copy lives in Drive.
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ITEM = 4 * 1024 * 1024;
const cache = new Map();
let bytes = 0;

function remember(id, entry) {
  if (entry.buffer.length > MAX_ITEM) return;
  cache.set(id, entry);
  bytes += entry.buffer.length;
  while (bytes > MAX_BYTES && cache.size) {
    const [oldest, value] = cache.entries().next().value;
    cache.delete(oldest);
    bytes -= value.buffer.length;
  }
}

async function fetchFile(fileId) {
  const hit = cache.get(fileId);
  if (hit) {
    cache.delete(fileId);
    cache.set(fileId, hit); // refresh LRU position
    return hit;
  }
  const file = await driveService.download(fileId);
  remember(fileId, file);
  return file;
}

/** Public media: only files referenced by catalog/settings (never payment proofs). */
export async function getPublicMedia(fileId) {
  const catalog = await getCatalog();
  if (!publicFileIds(catalog).has(fileId)) throw notFound('Image not found.');
  return fetchFile(fileId);
}

/** Admin preview of any uploaded file (e.g. images not yet published). */
export async function getAdminMedia(fileId) {
  return fetchFile(fileId);
}
