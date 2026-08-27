// server/settings.js
//
// שמירת הגדרות גלובליות של המערכת (כרגע: קולות ברירת המחדל ל-TTS)
// בקובץ JSON פשוט, כדי שניתן יהיה לבחור אותן מהממשק ולא רק דרך .env.
// אם לא נשמרה הגדרה - חוזרים לברירת המחדל מהמשתני סביבה (TTS_VOICE_NORMAL/BOLD).

const path = require('path');
const fs = require('fs-extra');

const SETTINGS_FILE = process.env.SETTINGS_FILE
  || path.join(__dirname, '..', 'data', 'settings.json');

async function getSettings() {
  if (!(await fs.pathExists(SETTINGS_FILE))) return {};
  return fs.readJson(SETTINGS_FILE);
}

async function updateSettings(patch) {
  const current = await getSettings();
  const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await fs.ensureDir(path.dirname(SETTINGS_FILE));
  await fs.writeJson(SETTINGS_FILE, merged, { spaces: 2 });
  return merged;
}

/** מחזיר את הקולות בפועל שיש להשתמש בהם: הגדרה שמורה, אחרת ברירת מחדל מ-.env */
async function getVoices() {
  const settings = await getSettings();
  return {
    voiceNormal: settings.voiceNormal || process.env.TTS_VOICE_NORMAL || '',
    voiceBold: settings.voiceBold || process.env.TTS_VOICE_BOLD || '',
  };
}

module.exports = { getSettings, updateSettings, getVoices };
