// server/playerApi.js
//
// מטפל בשתי הפעולות היחידות שדורשות שרת חיצוני תוך כדי השמעת עמוד גמרא
// (שאר הפקדים - 1/3/4/6/7/9/5 - נייטיביים לגמרי בימות, מוגדרים ב-ext.ini):
//
//   מקש 2 - מעבר בין גמרא / רש"י / תוספות, עם שחזור מיקום מדויק
//           לכל מפרש בנפרד (כי ymot native "חזרה למיקום אחרון" עובד רק
//           בניתוק שיחה, לא במעבר תוך-שיחתי בין "ערוצים").
//   מקש 8 - תפריט מידע (מסכת/דף/עמוד/דקה) + מעבר לדף הבא/הקודם.
//
// שני המקשים מוגדרים בשלוחת ה-playfile של כל track כך:
//   control_play2=send_api
//   control_play8=send_api
// (ראה config/ext-playfile-daf.ini)
//
// ימות שולח לכתובת הזו (מודול playfile, send_api) את הפרמטרים:
//   what      - נתיב+שם הקובץ המלא שמתנגן, לדוגמה: ivr2:/20/bava-kama/002/a/gemara.wav
//   PlayStop  - נקודת העצירה הנוכחית באלפיות שנייה
//   PressKey  - המקש עליו נלחץ (2 או 8)
//   ApiPhone  - מספר המתקשר

const express = require('express');
const fs = require('fs-extra');
const router = express.Router();

const db = require('./db');
const contentIndex = require('./contentIndex');
const proto = require('./yemotProtocol');

router.use(express.urlencoded({ extended: true }));
router.use((req, res, next) => {
  res.type('text/plain; charset=utf-8');
  next();
});

/** מפרק את פרמטר ה-what שימות שולח למרכיבי (מסכת, דף, עמוד, track) */
function parseWhat(what) {
  // דוגמה: ivr2:/20/bava-kama/002/a/gemara.wav
  const m = /\/20\/([^/]+)\/(\d+)\/([ab])\/([^/.]+)\.wav$/.exec(what || '');
  if (!m) return null;
  const [, masechet, dafStr, amud, track] = m;
  return { masechet, daf: parseInt(dafStr, 10), amud, track };
}

function folderFor(masechet, daf, amud, track) {
  const dafPadded = String(daf).padStart(3, '0');
  // track נבחר ע"י שם הקובץ עצמו (gemara/rashi/tosafot) בתוך אותה שלוחת עמוד
  return { folder: `/20/${masechet}/${dafPadded}/${amud}`, file: track };
}

router.all('/control', (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || 'unknown';
  const pressKey = params.PressKey;
  const playStopMs = parseInt(params.PlayStop, 10) || 0;
  const current = parseWhat(params.what);

  if (!current) {
    return res.send(proto.idListMessage([proto.textItem('שגיאה בזיהוי הקובץ הנוכחי')]));
  }

  // תמיד שומרים קודם כל את המיקום הנוכחי - בין אם ממשיכים לפעולה נוספת ובין אם לא
  db.savePosition(phone, current.masechet, current.daf, current.amud, current.track, playStopMs);
  db.setCallState(phone, {
    masechet: current.masechet, daf: current.daf, amud: current.amud, track: current.track,
  });

  if (pressKey === '8') {
    return jumpDaf(req, res, phone, current, +1);
  }
  if (pressKey === '*') {
    return jumpDaf(req, res, phone, current, -1);
  }

  // ברירת מחדל: חוזרים להשמעה מאותה נקודה בדיוק
  const { folder, file } = folderFor(current.masechet, current.daf, current.amud, current.track);
  return res.send(proto.goToFolderAndPlay(folder, file, playStopMs));
});

/**
 * מעבר ישיר למפרש (או חזרה לגמרא אם כבר נמצאים באותו מפרש) - פעולה
 * אחת מיידית, בלי read/תת-תפריט (זה מה שלא עבד בגרסה הקודמת: ניסיון
 * לבקש עוד הקשה תוך כדי send_api מתוך playfile לא נתמך בפועל).
 */
/** מעבר ישיר לדף הבא/הקודם (direction: +1/-1) - פעולה מיידית אחת */
function jumpDaf(req, res, phone, current, direction) {
  const targetDaf = current.daf + direction;

  if (!contentIndex.amudExists(current.masechet, targetDaf, current.amud)) {
    const { folder, file } = folderFor(current.masechet, current.daf, current.amud, current.track);
    return res.send(proto.chain(
      proto.idListMessage([proto.textItem('הדף המבוקש אינו קיים')]),
      proto.goToFolderAndPlay(folder, file, 0),
    ));
  }

  db.setCallState(phone, { daf: targetDaf, track: 'gemara' });
  const savedOffset = db.getPosition(phone, current.masechet, targetDaf, current.amud, 'gemara');
  const { folder } = folderFor(current.masechet, targetDaf, current.amud, 'gemara');
  return res.send(proto.goToFolderAndPlay(folder, 'gemara', savedOffset));
}

module.exports = router;
