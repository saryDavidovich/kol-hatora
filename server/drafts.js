// server/drafts.js
const path = require('path');
const fs = require('fs-extra');

const DRAFTS_ROOT = process.env.DRAFTS_ROOT || path.join(__dirname, '..', 'data', 'drafts');

function draftPath(masechet, daf, amud) {
  const dafPadded = String(daf).padStart(3, '0');
  return path.join(DRAFTS_ROOT, masechet, `daf-${dafPadded}-${amud}.json`);
}

async function getDraft(masechet, daf, amud) {
  const p = draftPath(masechet, daf, amud);
  if (!(await fs.pathExists(p))) return null;
  return fs.readJson(p);
}

async function saveDraft(masechet, daf, amud, data) {
  const p = draftPath(masechet, daf, amud);
  await fs.ensureDir(path.dirname(p));
  await fs.writeJson(p, { ...data, updatedAt: new Date().toISOString() }, { spaces: 2 });
  return true;
}

module.exports = { getDraft, saveDraft };
