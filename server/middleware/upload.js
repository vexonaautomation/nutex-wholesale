import multer from 'multer';

// Uploads are held in memory only long enough to stream them to Google Drive.
// Nothing is written to the Render filesystem.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20 },
});
