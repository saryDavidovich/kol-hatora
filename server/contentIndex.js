// server/contentIndex.js
const path = require('path');
const fs = require('fs-extra');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

function amudDir(masechet, daf, amud) {
  const dafPadded = String(daf).padStart(3, '0');
  return path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, amud);
}

function trackFile(masechet, daf, amud, track) {
  return path.join(amudDir(masechet, daf, amud), `${track}.wav`);
}

function amudExists(masechet, daf, amud) {
  return fs.existsSync(trackFile(masechet, daf, amud, 'gemara'));
}

module.exports = { amudDir, trackFile, amudExists, CONTENT_ROOT };
