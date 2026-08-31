// server/playerApi.js
//
// מטפל בפעולות שדורשות שרת חיצוני תוך כדי השמעת קובץ (שאר הפקדים -
// 1/3/4/6/7/9/5 - נייטיביים לגמרי בימות, מוגדרים ב-ext.ini):
//
//   - עמודי גמרא: מקש 8/# (דף הבא/קודם), תפריט "אפשרויות נוספות" (*)
//     למעבר בין גמרא/רש"י/תוספות.
//   - צמתי תוכן גנריים (server/nodeContent.js): תפריט "אפשרויות נוספות"
//     (*) למעבר בין תוכן ראשי לתתי-תוכן (מספרם משתנה לפי מה שהוגדר).
//
// *** פענוח דינמי *** - מאז שהמעבר למספור שלוחות לפי מיקום בעץ (לא עוד
// "/20" קבוע), אי אפשר לזהות את סוג התוכן (גמרא מול גנרי) רק מהתבנית
// של הנתיב - צריך לבדוק מול העץ בפועל (ראה resolveWhat למטה).

const express = require('express');
const fs = require('fs-extra');
const router = express.Router();

const db = require('./db');
const contentIndex = require('./contentIndex');
const nodeContent = require('./nodeContent');
const menuTree = require('./menuTree');
const proto = require('./yemotProtocol');

router.use(express.urlencoded({ extended: true }));
router.use((req, res, next) => {
  res.type('text/plain; charset=utf-8');
  next();
});

/**
 * מפענח את פרמטר ה-what שימות שולח (למשל "ivr2:/2/1/002/a/gemara.wav"
 * או "ivr2:/1/1/1/1/main.wav") ומזהה אם זה עמוד גמרא או צומת תוכן
 * גנרי, לפי בדיקה מול העץ בפועל (לא לפי תבנית קבועה מראש).
 */
async function resolveWhat(what) {
  const cleaned = (what || '').replace(/^ivr2:/, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (!parts.length) return null;

  const filename = parts[parts.length - 1];
  const track = filename.replace(/\.wav$/i, '');
  const pathParts = parts.slice(0, -1);
  const tree = await menuTree.getTree();

  // ניסיון 1: עמוד גמרא - שתי הרמות האחרונות הן דף (3 ספרות) + עמוד (a/b)
  if (pathParts.length >= 3) {
    const maybeAmud = pathParts[pathParts.length - 1];
    const maybeDaf = pathParts[pathParts.length - 2];
    if (/^\d{3}$/.test(maybeDaf) && (maybeAmud === 'a' || maybeAmud === 'b')) {
      const leafNums = pathParts.slice(0, -2).map(Number);
      if (leafNums.every((n) => !Number.isNaN(n))) {
        const node = menuTree.findNodeByYemotPath(tree, leafNums);
        if (node && node.contentRef) {
          return { type: 'gemara', masechet: node.contentRef, daf: parseInt(maybeDaf, 10), amud: maybeAmud, track };
        }
      }
    }
  }

  // ניסיון 2: צומת תוכן גנרי - כל הנתיב (חוץ משם הקובץ) הוא הצומת עצמו
  const genericNums = pathParts.map(Number);
  if (genericNums.length && genericNums.every((n) => !Number.isNaN(n))) {
    const node = menuTree.findNodeByYemotPath(tree, genericNums);
    if (node) {
      return { type: 'generic', nodeId: node.id, track };
    }
  }

  return null;
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

  if (current.type === 'generic') {
    return handleGenericControl(res, phone, current, playStopMs, pressKey);
  }
  return handleGemaraControl(res, phone, current, playStopMs, pressKey);
});

// ==================== טיפול בעמוד גמרא (כמו קודם) ====================

async function gemaraFolderFor(masechet, daf, amud) {
  return menuTree.getMasechetYemotFolder(masechet, daf, amud);
}

async function handleGemaraControl(res, phone, current, playStopMs, pressKey) {
  db.savePosition(phone, current.masechet, current.daf, current.amud, current.track, playStopMs);
  db.setCallState(phone, {
    masechet: current.masechet, daf: current.daf, amud: current.amud, track: current.track,
  });

  if (pressKey === '8') return jumpDaf(res, phone, current, +1);
  if (pressKey === '#') return jumpDaf(res, phone, current, -1);
  if (pressKey === '*-1') return toggleTrack(res, phone, current, playStopMs, 'rashi');
  if (pressKey === '*-2') return toggleTrack(res, phone, current, playStopMs, 'tosafot');
  if (pressKey === '*-8') return toggleTrack(res, phone, current, playStopMs, 'gemara');

  const folder = await gemaraFolderFor(current.masechet, current.daf, current.amud);
  return res.send(proto.goToFolderAndPlay(folder, current.track, playStopMs));
}

async function toggleTrack(res, phone, current, playStopMs, targetTrack) {
  const actualTarget = current.track === targetTrack ? 'gemara' : targetTrack;

  const trackFile = contentIndex.trackFile(current.masechet, current.daf, current.amud, actualTarget);
  if (!fs.existsSync(trackFile)) {
    const folder = await gemaraFolderFor(current.masechet, current.daf, current.amud);
    return res.send(proto.chain(
      proto.idListMessage([proto.textItem('המפרש המבוקש אינו זמין לעמוד זה')]),
      proto.goToFolderAndPlay(folder, current.track, playStopMs),
    ));
  }

  const savedOffset = db.getPosition(phone, current.masechet, current.daf, current.amud, actualTarget);
  db.setCallState(phone, { track: actualTarget });
  const folder = await gemaraFolderFor(current.masechet, current.daf, current.amud);
  return res.send(proto.goToFolderAndPlay(folder, actualTarget, savedOffset));
}

async function jumpDaf(res, phone, current, direction) {
  const targetDaf = current.daf + direction;

  if (!contentIndex.amudExists(current.masechet, targetDaf, current.amud)) {
    const folder = await gemaraFolderFor(current.masechet, current.daf, current.amud);
    return res.send(proto.chain(
      proto.idListMessage([proto.textItem('הדף המבוקש אינו קיים')]),
      proto.goToFolderAndPlay(folder, current.track, 0),
    ));
  }

  db.setCallState(phone, { daf: targetDaf, track: 'gemara' });
  const savedOffset = db.getPosition(phone, current.masechet, targetDaf, current.amud, 'gemara');
  const folder = await gemaraFolderFor(current.masechet, targetDaf, current.amud);
  return res.send(proto.goToFolderAndPlay(folder, 'gemara', savedOffset));
}

// ==================== טיפול בצומת תוכן גנרי (חדש) ====================
//
// שימוש ב"תפריט אפשרויות נוספות" הילידי, בדיוק כמו בגמרא: מקש * פותח
// תפריט ילידי, ורק הבחירה הסופית (*-1 עד *-7 לתתי-תוכן, *-8 לתוכן
// הראשי) מגיעה אלינו - מספר תתי-התוכן הזמינים נקבע דינמית בזמן
// ההעלאה לימות (ראה server/nodeContentRoutes.js), עד 7 תתי-תוכן.
//
// שמירת מיקום: הטבלה positions דורשת daf/amud כחלק מהמפתח - לצמתים
// גנריים (שאין להם דף/עמוד) משתמשים בערכי placeholder קבועים (0, 'x').

const GENERIC_DAF_PLACEHOLDER = 0;
const GENERIC_AMUD_PLACEHOLDER = 'x';

async function handleGenericControl(res, phone, current, playStopMs, pressKey) {
  db.savePosition(phone, current.nodeId, GENERIC_DAF_PLACEHOLDER, GENERIC_AMUD_PLACEHOLDER, current.track, playStopMs);
  db.setCallState(phone, {
    masechet: current.nodeId, daf: null, amud: null, track: current.track,
  });

  const tree = await menuTree.getTree();
  const yemotPath = menuTree.getYemotPath(tree, current.nodeId);
  const folder = `/${yemotPath.join('/')}`;

  const moreAMatch = /^\*-(\d)$/.exec(pressKey || '');
  if (moreAMatch) {
    const digit = moreAMatch[1];
    const content = await nodeContent.getContent(current.nodeId);

    let targetTrack;
    if (digit === '8') {
      targetTrack = 'main';
    } else {
      const sub = content.subContents[parseInt(digit, 10) - 1];
      if (!sub) {
        return res.send(proto.chain(
          proto.idListMessage([proto.textItem('תת-תוכן זה אינו קיים')]),
          proto.goToFolderAndPlay(folder, current.track, playStopMs),
        ));
      }
      targetTrack = sub.id;
    }

    const savedOffset = db.getPosition(phone, current.nodeId, GENERIC_DAF_PLACEHOLDER, GENERIC_AMUD_PLACEHOLDER, targetTrack);
    db.setCallState(phone, { track: targetTrack });
    return res.send(proto.goToFolderAndPlay(folder, targetTrack, savedOffset));
  }

  return res.send(proto.goToFolderAndPlay(folder, current.track, playStopMs));
}

module.exports = router;
