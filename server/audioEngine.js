// server/audioEngine.js
// אחראי על "חיתוך חי" של קובץ אודיו החל מנקודת זמן מסוימת (offset),
// ועל שינוי מהירות ניגון (עצם ה-atempo של ffmpeg, לא הקלטה כפולה).
//
// עיקרון חשוב: ה-offset שנשמר במסד הנתונים הוא תמיד ביחס לזמן ה"מקורי"
// של ההקלטה (כאילו במהירות רגילה 1.0), ולא ביחס למה שהמאזין שמע בפועל.
// כך קפיצה של "3 דקות קדימה" תמיד קופצת 3 דקות תוכן אמיתי, גם אם
// המאזין שינה את קצב ההשמעה.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const TMP_ROOT = process.env.TMP_ROOT || path.join(__dirname, '..', 'data', 'tmp');
fs.ensureDirSync(TMP_ROOT);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

/** משך הקובץ בשניות, לפי ffprobe */
async function getDurationSeconds(filePath) {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  return parseFloat(out.trim());
}

/**
 * atempo של ffmpeg תקף רק בטווח 0.5-2.0 בכל שלב בודד.
 * לכן במהירויות קיצוניות משרשרים כמה פילטרים.
 * לדוגמה 0.35 => atempo=0.5,atempo=0.7  (בערך; כאן מפרקים ל-0.5 צעדים)
 */
function buildAtempoFilter(speed) {
  if (speed === 1.0) return null;
  const filters = [];
  let remaining = speed;
  while (remaining < 0.5 || remaining > 2.0) {
    if (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    } else {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
  }
  filters.push(`atempo=${remaining.toFixed(3)}`);
  return filters.join(',');
}

/**
 * חותך את הקובץ מ-offsetMs ועד סוף הקובץ (או עד maxDurationSec אם צוין -
 * שימושי כדי לא לשלוח לימות קובץ ענק בבת אחת), ומחיל שינוי מהירות אם צריך.
 * מחזיר נתיב לקובץ WAV זמני מוכן להגשה לימות.
 */
async function cutAndPrepare({ filePath, offsetMs, speed = 1.0, maxDurationSec = null }) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`קובץ מקור לא נמצא: ${filePath}`);
  }

  const offsetSec = Math.max(0, offsetMs / 1000);
  const outName = `seg_${crypto.randomBytes(6).toString('hex')}.wav`;
  const outPath = path.join(TMP_ROOT, outName);

  const args = ['-y', '-ss', offsetSec.toFixed(3), '-i', filePath];

  if (maxDurationSec) {
    args.push('-t', String(maxDurationSec));
  }

  const atempoFilter = buildAtempoFilter(speed);
  if (atempoFilter) {
    args.push('-filter:a', atempoFilter);
  }

  // ימות עובד בד"כ עם WAV mono 8kHz PCM - יש לוודא מול התיעוד העדכני של ימות
  // (בשלוחת ההגדרות המתקדמות) איזה פורמט מדויק הם דורשים כרגע.
  args.push('-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', outPath);

  await run('ffmpeg', args);

  // ניקוי קבצים זמניים ישנים (מעל שעה) כדי לא להציף את הדיסק
  cleanupOldTemp().catch(() => {});

  return outPath;
}

async function cleanupOldTemp() {
  const files = await fs.readdir(TMP_ROOT);
  const now = Date.now();
  await Promise.all(files.map(async (f) => {
    const fp = path.join(TMP_ROOT, f);
    const stat = await fs.stat(fp);
    if (now - stat.mtimeMs > 60 * 60 * 1000) {
      await fs.remove(fp);
    }
  }));
}

module.exports = { getDurationSeconds, cutAndPrepare, buildAtempoFilter, TMP_ROOT };
