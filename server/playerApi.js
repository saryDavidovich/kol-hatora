// server/playerApi.js
//
// מטפל בפעולות שדורשות שרת תוך כדי השמעת קובץ (שאר הפקדים - 1/3/4/6/
// 7/9/5 - נייטיביים לגמרי בימות, מוגדרים ב-ext.ini): מקש 8/# (דף הבא/
// קודם), ותפריט "אפשרויות נוספות" הילידי (*) למעבר בין גמרא/רש"י/תוספות.

const express = require('express');
const fs = require('fs-extra');
const router = express.Router();

const db = require('./db');
const contentIndex = require('./contentIndex');
const menuTree = require('./menuTree');
const proto = require('./yemotProtocol');

router.use(express.urlencoded({ extended: true }));
router.use((req, res, next) => {
  res.type('text/plain; charset=utf-8');
  next();
});

/** מפענח את פרמטר ה-what ("ivr2:/1/1/1/1/002/a/gemara.wav") לפי בדיקה מול העץ */
async function resolveWhat(what) {
  const cleaned = (what || '').replace(/^ivr2:/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 3) return null;

  const filename = parts[parts.length - 1];
  const track = filename.replace(/\.wav$/i, '');
  const maybeAmud = parts[parts.length - 2];
  const maybeDaf = parts[parts.length - 3];
  if (!/^\d{3}$/.test(maybeDaf) || (maybeAmud !== 'a' && maybeAmud !== 'b')) return null;

  const leafNums = parts.slice(0, -3).map(Number);
  if (!leafNums.length || leafNums.some((n) => Number.isNaN(n))) return null;

  const tree = await menuTree.getTree();
  const node = menuTree.findNodeByYemotPath(tree, leafNums);
  if (!node || !node.contentRef) return null;

  return { masechet: node.contentRef, daf: parseInt(maybeDaf, 10), amud: maybeAmud, track };
}

async function folderFor(masechet, daf, amud) {
  return menuTree.getMasechetYemotFolder(masechet, daf, amud);
}

router.all('/control', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || 'unknown';
  const pressKey = params.PressKey;
  const playStopMs = parseInt(params.PlayStop, 10) || 0;

  const current = await resolveWhat(params.what);
  if (!current) {
    return res.send(proto.idListMessage([proto.textItem('שגיאה בזיהוי הקובץ הנוכחי')]));
  }

  db.savePosition(phone, current.masechet, current.daf, current.amud, current.track, playStopMs);
  db.setCallState(phone, {
    masechet: current.masechet, daf: current.daf, amud: current.amud, track: current.track,
  });

  if (pressKey === '8') return jumpDaf(res, phone, current, +1);
  if (pressKey === '#') return jumpDaf(res, phone, current, -1);
  if (pressKey === '*-1') return toggleTrack(res, phone, current, playStopMs, 'rashi');
  if (pressKey === '*-2') return toggleTrack(res, phone, current, playStopMs, 'tosafot');
  if (pressKey === '*-8') return toggleTrack(res, phone, current, playStopMs, 'gemara');

  const folder = await folderFor(current.masechet, current.daf, current.amud);
  return res.send(proto.goToFolderAndPlay(folder, current.track, playStopMs));
});

async function toggleTrack(res, phone, current, playStopMs, targetTrack) {
  const actualTarget = current.track === targetTrack ? 'gemara' : targetTrack;

  const trackFile = contentIndex.trackFile(current.masechet, current.daf, current.amud, actualTarget);
  if (!(await fs.pathExists(trackFile))) {
    const folder = await folderFor(current.masechet, current.daf, current.amud);
    return res.send(proto.chain(
      proto.idListMessage([proto.textItem('המפרש המבוקש אינו זמין לעמוד זה')]),
      proto.goToFolderAndPlay(folder, current.track, playStopMs),
    ));
  }

  const savedOffset = db.getPosition(phone, current.masechet, current.daf, current.amud, actualTarget);
  db.setCallState(phone, { track: actualTarget });
  const folder = await folderFor(current.masechet, current.daf, current.amud);
  return res.send(proto.goToFolderAndPlay(folder, actualTarget, savedOffset));
}

async function jumpDaf(res, phone, current, direction) {
  const targetDaf = current.daf + direction;

  if (!contentIndex.amudExists(current.masechet, targetDaf, current.amud)) {
    const folder = await folderFor(current.masechet, current.daf, current.amud);
    return res.send(proto.chain(
      proto.idListMessage([proto.textItem('הדף המבוקש אינו קיים')]),
      proto.goToFolderAndPlay(folder, current.track, 0),
    ));
  }

  db.setCallState(phone, { daf: targetDaf, track: 'gemara' });
  const savedOffset = db.getPosition(phone, current.masechet, targetDaf, current.amud, 'gemara');
  const folder = await folderFor(current.masechet, targetDaf, current.amud);
  return res.send(proto.goToFolderAndPlay(folder, 'gemara', savedOffset));
}

module.exports = router;
