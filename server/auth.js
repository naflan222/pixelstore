// Session authentication helpers
const crypto = require('crypto');
const db = require('./db');

const SESSION_DAYS = 30;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, userId);
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.email, u.full_name, u.phone, u.address, u.avatar, u.balance, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token);
  return row || null;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Express middleware: attaches req.user when a valid session cookie exists.
// Also assigns a guest id cookie so visitors can shop WITHOUT an account.
function attachUser(req, res, next) {
  req.user = getUserByToken(req.cookies && req.cookies.pixels_session);
  let guestId = req.cookies && req.cookies.pixels_guest;
  if (!guestId || !/^[a-f0-9]{32}$/.test(guestId)) {
    guestId = crypto.randomBytes(16).toString('hex');
    res.cookie('pixels_guest', guestId, { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 3600 * 1000 });
  }
  req.guestId = guestId;
  next();
}

// Guard for API endpoints that require login
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Guard for admin-only API endpoints
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { createSession, getUserByToken, destroySession, attachUser, requireAuth, requireAdmin };
