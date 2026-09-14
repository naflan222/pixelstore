// Session authentication helpers
const crypto = require('crypto');
const db = require('./database');

const SESSION_DAYS = 30;

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token, userId, db.utcNow(SESSION_DAYS * 24 * 3600 * 1000)
  );
  return token;
}

async function getUserByToken(token) {
  if (!token) return null;
  const row = await db.get(`
    SELECT u.id, u.username, u.email, u.full_name, u.phone, u.address, u.avatar, u.balance, u.role, u.is_active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.is_active = 1 AND s.expires_at > ?`, token, db.utcNow());
  return row || null;
}

async function destroySession(token) {
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', token);
}

// Express middleware: attaches req.user when a valid session cookie exists.
// Also assigns a guest id cookie so visitors can shop WITHOUT an account.
async function attachUser(req, res, next) {
  try {
    req.user = await getUserByToken(req.cookies && req.cookies.pixels_session);
  } catch (error) {
    return next(error);
  }
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
  if (!['owner', 'admin', 'order_manager', 'catalog_manager', 'support'].includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requirePermission(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action' });
    next();
  };
}

module.exports = { createSession, getUserByToken, destroySession, attachUser, requireAuth, requireAdmin, requirePermission };
