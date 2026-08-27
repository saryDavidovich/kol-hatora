// server/adminAuth.js
//
// אימות מינימלי לממשק הניהול: קוד כניסה יחיד (לא ניהול משתמשים מלא -
// זה ממשק ניהול תוכן פנימי, לא מוצר רב-משתמשים). הקוד מוגדר ב-.env
// כ-ADMIN_ACCESS_CODE. בהצלחה, נשלחת עוגיה חתומה (HMAC) שתקפה ל-12 שעות.
//
// לא נדרש npm חדש - שימוש ב-crypto המובנה של Node לחתימה.

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 שעות
const COOKIE_NAME = 'yemot_admin_session';

function sign(value) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${hmac}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

function createSessionCookieValue() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return sign(String(expiresAt));
}

function isValidSession(cookieValue) {
  const expiresAtStr = verify(cookieValue);
  if (!expiresAtStr) return false;
  return Date.now() < parseInt(expiresAtStr, 10);
}

/** Middleware: חוסם גישה לנתיבי /admin/api/* ללא סשן תקין */
function requireAdminAuth(req, res, next) {
  const cookie = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (isValidSession(cookie)) return next();
  return res.status(401).json({ error: 'לא מחוברים - יש להתחבר עם קוד הכניסה' });
}

function handleLogin(req, res) {
  const { code } = req.body || {};
  const expected = process.env.ADMIN_ACCESS_CODE;

  if (!expected) {
    return res.status(500).json({ error: 'לא הוגדר ADMIN_ACCESS_CODE ב-.env - יש להגדיר קוד כניסה' });
  }
  if (!code || code !== expected) {
    return res.status(401).json({ error: 'קוד כניסה שגוי' });
  }

  const cookieValue = createSessionCookieValue();
  res.cookie(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
  return res.json({ ok: true });
}

function handleLogout(req, res) {
  res.clearCookie(COOKIE_NAME);
  return res.json({ ok: true });
}

module.exports = { requireAdminAuth, handleLogin, handleLogout, COOKIE_NAME };
