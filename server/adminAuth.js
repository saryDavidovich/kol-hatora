// server/adminAuth.js
const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || 'admin';
const COOKIE_NAME = 'yemot_admin_session';

function sign(value) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}
function verify(signed) {
  if (!signed) return false;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return false;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  return sign(value) === signed && value === 'ok';
}

function handleLogin(req, res) {
  const { code } = req.body || {};
  if (code !== ADMIN_ACCESS_CODE) {
    return res.status(401).json({ error: 'קוד גישה שגוי' });
  }
  const token = sign('ok');
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ ok: true });
}

function handleLogout(req, res) {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
}

function requireAdminAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (verify(token)) return next();
  res.status(401).json({ error: 'נדרשת התחברות' });
}

module.exports = { handleLogin, handleLogout, requireAdminAuth };
