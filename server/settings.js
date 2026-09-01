// server/settings.js
const path = require('path');
const fs = require('fs-extra');

const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(__dirname, '..', 'data', 'settings.json');

async function getSettings() {
  if (!(await fs.pathExists(SETTINGS_FILE))) return { voiceNormal: null, voiceBold: null };
  return fs.readJson(SETTINGS_FILE);
}

async function saveSettings(settings) {
  await fs.ensureDir(path.dirname(SETTINGS_FILE));
  await fs.writeJson(SETTINGS_FILE, settings, { spaces: 2 });
  return settings;
}

async function getVoices() {
  const s = await getSettings();
  return { voiceNormal: s.voiceNormal, voiceBold: s.voiceBold || s.voiceNormal };
}

module.exports = { getSettings, saveSettings, getVoices };
