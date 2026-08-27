// server/drafts.js
//
// שומר את הטקסט הערוך (אחרי תיקונים/ניקוד שהמנהל ביצע בממשק הניהול)
// לפני שהוא נשלח ל-TTS. זה נפרד לגמרי מהתוכן הסופי שנבנה בפועל
// (data/shas-content) - כאן זו רק "טיוטת עבודה" בפורמט JSON פשוט.

const path = require('path');
const fs = require('fs-extra');

const DRAFTS_ROOT = process.env.DRAFTS_ROOT || path.join(__dirname, '..', 'data', 'drafts');

function draftPath(masechet, daf, amud) {
  const dafPadded = String(daf).padStart(3, '0');
  return path.join(DRAFTS_ROOT, masechet, `daf-${dafPadded}`, `${amud}.json`);
}

async function getDraft(masechet, daf, amud) {
  const p = draftPath(masechet, daf, amud);
  if (!(await fs.pathExists(p))) return null;
  return fs.readJson(p);
}

async function saveDraft(masechet, daf, amud, data) {
  const p = draftPath(masechet, daf, amud);
  await fs.ensureDir(path.dirname(p));
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await fs.writeJson(p, payload, { spaces: 2 });
  return payload;
}

module.exports = { getDraft, saveDraft, draftPath };
