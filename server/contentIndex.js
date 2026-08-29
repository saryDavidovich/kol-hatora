// server/contentIndex.js
// אחראי לדעת "מה קיים" במערכת: אילו נושאים, ספרים (מסכתות), דפים ועמודים,
// ואיפה נמצא כל קובץ אודיו + מפת הזמנים (timeline) שלו.
//
// מבנה תיקיות שה-pipeline יוצר (ראה pipeline/buildAudio.js):
//
// CONTENT_ROOT/
//   index.json                          <- רשימת נושאים וספרים
//   shas/
//     בבא_קמא/
//       daf-002/
//         a/
//           gemara.wav
//           gemara.timeline.json        <- מיפוי קטעי טקסט <-> זמנים, כולל דגלי "מודגש"
//           rashi.wav
//           rashi.timeline.json
//           tosafot.wav
//           tosafot.timeline.json
//           meta.json                   <- { masechet, daf, amud, durations: {...} }

const path = require('path');
const fs = require('fs-extra');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

function loadTopicsIndex() {
  const p = path.join(CONTENT_ROOT, 'index.json');
  if (!fs.existsSync(p)) return { topics: [] };
  return fs.readJsonSync(p);
}

/**
 * זריעה אוטומטית: אם index.json חסר (וואלום חדש/ריק, דיפלוי ראשון,
 * או כל סיבה אחרת) - כותבים אותו מיד מתוך הרשימה המשותפת ב-
 * pipeline/topicsData.js. כך התפריט הראשי תמיד יעבוד בלי תלות בסדר
 * הפעולות של המנהל (אין צורך להריץ סקריפט נפרד ידנית אחרי כל שינוי
 * בתשתית האחסון, כמו מעבר בין נתיב יחסי ל-Volume).
 */
function ensureTopicsIndex() {
  const p = path.join(CONTENT_ROOT, 'index.json');
  if (fs.existsSync(p)) return;
  try {
    const { topics } = require('../pipeline/topicsData');
    fs.ensureDirSync(CONTENT_ROOT);
    fs.writeJsonSync(p, { topics }, { spaces: 2 });
    console.log(`[contentIndex] נוצר index.json אוטומטית ב-${p}`);
  } catch (err) {
    console.error(`[contentIndex] נכשל ביצירת index.json אוטומטית: ${err.message}`);
  }
}
ensureTopicsIndex();

function amudDir(masechet, daf, amud) {
  const dafPadded = String(daf).padStart(3, '0');
  return path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, amud);
}

function loadMeta(masechet, daf, amud) {
  const p = path.join(amudDir(masechet, daf, amud), 'meta.json');
  if (!fs.existsSync(p)) return null;
  return fs.readJsonSync(p);
}

function trackFile(masechet, daf, amud, track) {
  // track: 'gemara' | 'rashi' | 'tosafot'
  return path.join(amudDir(masechet, daf, amud), `${track}.wav`);
}

function trackTimeline(masechet, daf, amud, track) {
  const p = path.join(amudDir(masechet, daf, amud), `${track}.timeline.json`);
  if (!fs.existsSync(p)) return null;
  return fs.readJsonSync(p);
}

/** בדיקה אם עמוד/דף/מסכת קיימים בפועל (לפני מעבר "דף הבא"/"דף קודם") */
function amudExists(masechet, daf, amud) {
  return fs.existsSync(trackFile(masechet, daf, amud, 'gemara'));
}

module.exports = {
  CONTENT_ROOT,
  loadTopicsIndex,
  amudDir,
  loadMeta,
  trackFile,
  trackTimeline,
  amudExists,
};
