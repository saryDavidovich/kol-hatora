// server/config.js
//
// המשתנה API_PLAYER_URL מכיל *רק* את הדומיין הבסיסי (למשל
// "https://kol-hatora-production.up.railway.app"), בלי נתיב - בכוונה,
// כדי שאותו משתנה יהיה שימושי גם למטרות עתידיות אחרות. הקוד תמיד
// מוסיף בעצמו את הנתיב הספציפי הנדרש (/api/player/control) - לא
// המשתמש. פונקציה משותפת אחת כדי שלא יהיה מקום אחד ששוכח להוסיף.

function getApiPlayerUrl() {
  const base = process.env.API_PLAYER_URL;
  if (!base) return null;
  const trimmed = base.replace(/\/+$/, ''); // מסירים / מיותר בסוף הדומיין
  return `${trimmed}/api/player/control`;
}

module.exports = { getApiPlayerUrl };
