// pipeline/batchRun.js
//
// מריץ את processAmud (מ-run.js) אוטומטית על טווח דפים שלם, מסכת שלמה,
// או כל הש"ס בבת אחת. זו הדרך הנכונה לעבוד - לא קוראים ל-run.js ידנית
// לכל דף. שימושים:
//
//   node pipeline/batchRun.js "בבא קמא"              <- מסכת שלמה
//   node pipeline/batchRun.js "בבא קמא" 2 20         <- טווח דפים נבחר
//   node pipeline/batchRun.js all                     <- כל הש"ס (!)
//
// תכונות מובנות:
//  - אידמפוטנטי: אם meta.json כבר קיים לעמוד מסוים, מדלג עליו (resume-safe -
//    אפשר להריץ שוב אחרי שנעצר/קרס באמצע בלי לעבוד פעמיים על אותו תוכן)
//  - retry עם backoff לכל עמוד שנכשל (רשת/TTS יכולים להיכשל מדי פעם)
//  - קצב מבוקר בין קריאות (כדי לא להציף את שרתי ויקיטקסט/ה-TTS)
//  - לוג התקדמות + קובץ לוג כשלים בסוף הריצה, כדי לדעת בדיוק מה נכשל

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');

const { processAmud } = require('./run');
const MASECHTOT_DAPIM = require('./masechtotDapim');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
const DELAY_MS = parseInt(process.env.PIPELINE_DELAY_MS || '1500', 10); // המתנה בין עמוד לעמוד
const MAX_RETRIES = parseInt(process.env.PIPELINE_MAX_RETRIES || '3', 10);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function amudMetaPath(masechet, daf, amud) {
  const dafPadded = String(daf).padStart(3, '0');
  return path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, amud, 'meta.json');
}

async function alreadyDone(masechet, daf, amud) {
  return fs.pathExists(amudMetaPath(masechet, daf, amud));
}

/** מריץ עמוד בודד עם retry, מבלי להפיל את כל התהליך אם הוא נכשל סופית */
async function runOneWithRetry(masechet, daf, amud, log) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await processAmud(masechet, daf, amud);
      log.done.push(`${masechet} ${daf}${amud}`);
      return true;
    } catch (err) {
      console.warn(`  ניסיון ${attempt}/${MAX_RETRIES} נכשל עבור ${masechet} ${daf}${amud}: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(DELAY_MS * attempt * 2); // backoff הדרגתי
      } else {
        log.failed.push({ masechet, daf, amud, error: err.message });
        return false;
      }
    }
  }
  return false;
}

/** מריץ מסכת שלמה (שני העמודים בכל דף, החל מדף ב') */
async function runMasechet(masechet, fromDaf, toDaf, log) {
  console.log(`\n=== מתחיל מסכת ${masechet} (דפים ${fromDaf}-${toDaf}) ===`);
  for (let daf = fromDaf; daf <= toDaf; daf++) {
    for (const amud of ['a', 'b']) {
      if (await alreadyDone(masechet, daf, amud)) {
        console.log(`  [דילוג - כבר קיים] ${masechet} ${daf}${amud}`);
        log.skipped.push(`${masechet} ${daf}${amud}`);
        continue;
      }
      console.log(`  מעבד ${masechet} ${daf}${amud} ...`);
      await runOneWithRetry(masechet, daf, amud, log);
      await sleep(DELAY_MS);
    }
  }
}

async function main() {
  const [arg1, arg2, arg3] = process.argv.slice(2);
  if (!arg1) {
    console.log('שימוש:');
    console.log('  node pipeline/batchRun.js "<מסכת>"              (מסכת שלמה)');
    console.log('  node pipeline/batchRun.js "<מסכת>" <מדף> <עדדף>  (טווח דפים)');
    console.log('  node pipeline/batchRun.js all                    (כל הש"ס)');
    process.exit(1);
  }

  const log = { done: [], skipped: [], failed: [], startedAt: new Date().toISOString() };

  if (arg1 === 'all') {
    for (const [masechet, maxDaf] of Object.entries(MASECHTOT_DAPIM)) {
      await runMasechet(masechet, 2, maxDaf, log);
    }
  } else {
    const masechet = arg1;
    const maxDaf = MASECHTOT_DAPIM[masechet];
    if (!maxDaf && !(arg2 && arg3)) {
      console.error(`מסכת "${masechet}" לא מוכרת בטבלת masechtotDapim.js - יש להוסיף אותה, או לציין טווח דפים ידנית`);
      process.exit(1);
    }
    const fromDaf = arg2 ? parseInt(arg2, 10) : 2;
    const toDaf = arg3 ? parseInt(arg3, 10) : maxDaf;
    await runMasechet(masechet, fromDaf, toDaf, log);
  }

  log.finishedAt = new Date().toISOString();

  const logDir = path.join(__dirname, '..', 'data', 'logs');
  await fs.ensureDir(logDir);
  const logPath = path.join(logDir, `batch-${Date.now()}.json`);
  await fs.writeJson(logPath, log, { spaces: 2 });

  console.log(`\n=== סיכום ===`);
  console.log(`הושלמו: ${log.done.length} | דולגו (כבר קיימים): ${log.skipped.length} | נכשלו: ${log.failed.length}`);
  if (log.failed.length) {
    console.log(`רשימת הכשלונות המלאה נשמרה ב: ${logPath}`);
    console.log('ניתן להריץ את אותה הפקודה שוב - עמודים שהצליחו יידלגו אוטומטית, רק הכשלונות ינוסו שוב.');
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('שגיאה כללית:', e); process.exit(1); });
}

module.exports = { runMasechet, runOneWithRetry };
