'use strict';
// Úložiště vlastních ikon kategorií na stejném svazku jako DB (persistuje přes
// deploye). Mimo public root — servíruje se jen přes authed route.
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data.db');
const ICON_DIR = path.join(path.dirname(path.resolve(DB_PATH)), 'cat-icons');

function ensureDir() {
  try { fs.mkdirSync(ICON_DIR, { recursive: true }); } catch { /* už existuje */ }
}

function iconPath(filename) {
  // Bezpečnost: bereme jen holý název souboru, nikdy klientskou cestu.
  return path.join(ICON_DIR, path.basename(filename));
}

// Dekóduje data URL → { buffer, ext } nebo null. Ověřuje magic bytes.
function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 7 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (m[1] === 'jpeg' && !isJpeg) return null;
  if (m[1] === 'png' && !isPng) return null;
  return { buffer: buf, ext: isPng ? 'png' : 'jpg' };
}

module.exports = { ICON_DIR, ensureDir, iconPath, decodeImage };
