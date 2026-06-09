const express = require('express');
const fs = require('fs');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { ensureDir, iconPath, decodeImage } = require('../utils/catIcons');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/categories/fund-status?year=Y  (musí být před /:id)
router.get('/fund-status', requireAuth, (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const cats = db.prepare(
    'SELECT * FROM categories WHERE user_id = ? AND type = 3 ORDER BY name ASC'
  ).all(req.dataUserId);

  const lastEver = db.prepare(`
    SELECT MAX(date) as last_date
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND amount < 0
  `);
  const yearSpent = db.prepare(`
    SELECT COALESCE(SUM(-amount), 0) as total
    FROM transactions
    WHERE user_id = ? AND category_id = ?
      AND date >= ? AND date <= ?
  `);

  const result = cats.map(cat => {
    const { last_date } = lastEver.get(req.dataUserId, cat.id);
    const { total } = yearSpent.get(req.dataUserId, cat.id, `${year}-01-01`, `${year}-12-31`);

    let months_since_last = null;
    if (last_date) {
      const diff = Date.now() - new Date(last_date + 'T00:00:00').getTime();
      months_since_last = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.5));
    }

    const monthly_contribution = cat.typical_price && cat.frequency_months
      ? Math.round(cat.typical_price / cat.frequency_months)
      : null;

    return {
      ...cat,
      last_payment_date: last_date || null,
      months_since_last,
      total_year: total,
      monthly_contribution,
    };
  });

  res.json(result);
});

// GET /api/categories
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC').all(req.dataUserId);
  res.json(rows);
});

// POST /api/categories
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, color, icon, type, typical_price, frequency_months } = req.body;
  if (!name) return res.status(400).json({ error: 'Název kategorie je povinný.' });

  let result;
  try {
    result = db.prepare(
      'INSERT INTO categories (user_id, name, color, icon, type, typical_price, frequency_months) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.dataUserId, name, color || '#6366f1', icon || 'tag', type || 1,
      typical_price != null ? parseFloat(typical_price) : null,
      frequency_months != null ? parseInt(frequency_months) : null);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return res.status(409).json({ error: 'Kategorie s tímto názvem už existuje.' });
    throw e;
  }

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/categories/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  const { name, color, icon, type, typical_price, frequency_months } = req.body;
  try {
    db.prepare(`
      UPDATE categories
      SET name = ?, color = ?, icon = ?, type = ?, typical_price = ?, frequency_months = ?
      WHERE id = ?
    `).run(
      name ?? cat.name,
      color ?? cat.color,
      icon ?? cat.icon,
      type ?? cat.type ?? 1,
      typical_price !== undefined ? (typical_price != null ? parseFloat(typical_price) : null) : cat.typical_price,
      frequency_months !== undefined ? (frequency_months != null ? parseInt(frequency_months) : null) : cat.frequency_months,
      cat.id
    );
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return res.status(409).json({ error: 'Kategorie s tímto názvem už existuje.' });
    throw e;
  }
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id));
});

// DELETE /api/categories/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  if (cat.icon_image) { try { fs.unlinkSync(iconPath(cat.icon_image)); } catch { /* soubor chybí */ } }
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  res.json({ ok: true });
});

function ownCat(req) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
}

// POST /api/categories/:id/icon  – nahrání vlastní ikony (base64 data URL)
router.post('/:id/icon', requireAuth, writeLimiter, (req, res) => {
  const cat = ownCat(req);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  const img = decodeImage(req.body.image);
  if (!img) return res.status(400).json({ error: 'Neplatný obrázek (jen JPEG/PNG).' });
  if (img.buffer.length > 200 * 1024) return res.status(400).json({ error: 'Ikona je příliš velká (max 200 KB).' });

  ensureDir();
  const filename = `${cat.id}-${Date.now()}.${img.ext}`;
  fs.writeFileSync(iconPath(filename), img.buffer);
  if (cat.icon_image && cat.icon_image !== filename) {
    try { fs.unlinkSync(iconPath(cat.icon_image)); } catch { /* předchozí soubor chybí */ }
  }
  db.prepare('UPDATE categories SET icon_image = ? WHERE id = ?').run(filename, cat.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id));
});

// DELETE /api/categories/:id/icon  – odebrání vlastní ikony
router.delete('/:id/icon', requireAuth, writeLimiter, (req, res) => {
  const cat = ownCat(req);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  if (cat.icon_image) { try { fs.unlinkSync(iconPath(cat.icon_image)); } catch { /* soubor chybí */ } }
  db.prepare('UPDATE categories SET icon_image = NULL WHERE id = ?').run(cat.id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id));
});

// GET /api/categories/:id/icon  – servíruje ikonu z volume
router.get('/:id/icon', requireAuth, (req, res) => {
  const cat = ownCat(req);
  if (!cat || !cat.icon_image) return res.status(404).end();
  const p = iconPath(cat.icon_image);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(cat.icon_image.endsWith('.png') ? 'image/png' : 'image/jpeg');
  res.send(fs.readFileSync(p));
});

module.exports = router;
