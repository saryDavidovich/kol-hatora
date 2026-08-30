// server/bookBatch.js
//
// ניהול מצב "עריכת ספר שלם": רשימת הדפים שנטענו מקובץ המסכת, ורשימת
// ראשי התיבות שנמצאו בכל הספר (או בדף בודד) עם סטטוס הגהה (ממתין/
// אושר) והרחבה שהמנהל הזין. הכל נשמר כקובץ JSON אחד לכל מסכת, בתוך
// CONTENT_ROOT - כדי לשרוד דיפלויים (אותו Volume כמו שאר התוכן).

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

function bookStatePath(masechet) {
  return path.join(CONTENT_ROOT, 'shas', masechet, 'book-state.json');
}

async function getBookState(masechet) {
  const p = bookStatePath(masechet);
  if (!(await fs.pathExists(p))) {
    return { masechet, amudim: {}, abbreviations: [] };
  }
  return fs.readJson(p);
}

async function saveBookState(masechet, state) {
  const p = bookStatePath(masechet);
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, state, { spaces: 2 });
  return state;
}

/** שומר את התוכן שחולץ מקובץ המסכת (gemara בלבד) לכל עמוד */
async function setAmudGemara(masechet, daf, amud, plainText) {
  const state = await getBookState(masechet);
  const key = `${daf}${amud}`;
  state.amudim[key] = { daf, amud, gemara: plainText, status: 'loaded' };
  return saveBookState(masechet, state);
}

/** מוסיף רשימת מופעי ראשי-תיבות חדשה (מוחק קודמת עבור אותו scope) */
async function setAbbreviations(masechet, scopeKey, occurrences) {
  const state = await getBookState(masechet);
  // scopeKey = 'book' לסריקת ספר שלם, או 'daf:<daf><amud>' לדף בודד
  state.abbreviations = (state.abbreviations || []).filter((a) => a.scope !== scopeKey);
  const withIds = occurrences.map((o) => ({
    ...o,
    id: crypto.randomBytes(6).toString('hex'),
    scope: scopeKey,
    status: 'pending', // pending | approved
    expansion: o.abbreviation, // ברירת מחדל - המנהל עורך את זה
  }));
  state.abbreviations.push(...withIds);
  await saveBookState(masechet, state);
  return withIds;
}

async function getAbbreviations(masechet, scopeKey) {
  const state = await getBookState(masechet);
  const all = state.abbreviations || [];
  return scopeKey ? all.filter((a) => a.scope === scopeKey) : all;
}

async function approveAbbreviation(masechet, id, expansion) {
  const state = await getBookState(masechet);
  const item = (state.abbreviations || []).find((a) => a.id === id);
  if (!item) throw new Error('ראש תיבה לא נמצא');
  item.expansion = expansion;
  item.status = 'approved';
  await saveBookState(masechet, state);
  return item;
}

module.exports = {
  getBookState, saveBookState, setAmudGemara, setAbbreviations, getAbbreviations, approveAbbreviation,
};
