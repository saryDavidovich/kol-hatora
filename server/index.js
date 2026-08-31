// server/index.js
//
// שרת זה הוא ה-"api_link" שאליו מצביעה שלוחת type=api הראשית בימות המשיח.
// הוא מנהל את הדיאלוג המדורג (נושא -> ספר -> דף -> עמוד) ע"י שרשור בקשות
// read חוזרות ונשנות, ובסיום - שולח go_to_folder_and_play שמפעיל בפועל
// את שלוחת ה-playfile המתאימה (שם כבר פועלים פקדי הניווט הנייטיביים של ימות:
// 1/3/4/6/7/9/5 - ראה config/ext-playfile-daf.ini).
//
// שני ה"אירועים" היחידים שבאמת דורשים לוגיקת שרת תוך כדי ההשמעה עצמה
// (ולא ניתנים למימוש נייטיבי בימות) מטופלים בקובץ playerApi.js:
//   - מקש 2: מעבר למפרש (רש"י/תוספות) + שחזור מיקום מדויק שבו נעצר בפעם הקודמת
//   - מקש 8: תפריט מידע/ניווט בין דפים

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const cookieParser = require('cookie-parser');
const contentIndex = require('./contentIndex');
const menuTree = require('./menuTree');
const db = require('./db');
const proto = require('./yemotProtocol');
const playerRoutes = require('./playerApi');
const adminAuth = require('./adminAuth');
const adminRoutes = require('./adminRoutes');

const app = express();

// רישום כל בקשה נכנסת ללוג - קריטי לאבחון תקלות עם ימות, כי בלי זה
// אין דרך לדעת אם בקשה בכלל הגיעה או שהיא נעלמה איפשהו בדרך.
// שלב 1: שיטה+נתיב, מודפס מיד (עוד לפני פענוח גוף הבקשה).
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// שלב 2: אחרי שגוף הבקשה כבר פוענח - מדפיסים גם אותו (רק לנתיבים
// הרלוונטיים לימות, כדי לא להציף את הלוג עם תעבורת ממשק הניהול),
// וגם עוטפים את res.send כדי לרשום ללוג בדיוק מה נשלח בחזרה
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) {
    if (Object.keys(req.body || {}).length) {
      console.log('  body:', JSON.stringify(req.body).slice(0, 500));
    }
    const originalSend = res.send.bind(res);
    res.send = (data) => {
      console.log('  >>> תשובה שנשלחת:', String(data).slice(0, 800));
      return originalSend(data);
    };
  }
  next();
});

app.use('/api/player', playerRoutes);

// --- ממשק ניהול (כניסה + עמוד עריכה) ---
app.post('/admin/api/login', express.json(), adminAuth.handleLogin);
app.post('/admin/api/logout', adminAuth.handleLogout);
app.use('/admin/api/book', adminAuth.requireAdminAuth, require('./bookRoutes'));
app.use('/admin/api/menu-tree', adminAuth.requireAdminAuth, require('./menuTreeRoutes'));
app.use('/admin/api/node-content', adminAuth.requireAdminAuth, require('./nodeContentRoutes'));
app.use('/admin/api', adminAuth.requireAdminAuth, adminRoutes);
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

app.get('/', (req, res) => {
  res.type('text/plain; charset=utf-8').send('שרת ימות-הש"ס פעיל. ממשק ניהול: /admin');
});

app.use((req, res, next) => {
  res.type('text/plain; charset=utf-8');
  next();
});

/**
 * מסלול יחיד המטפל בכל שלבי הבחירה, בעזרת שרשור read.
 * הפרמטרים params.topic / params.book / params.daf / params.amud
 * מצטברים ככל שהדיאלוג מתקדם (ימות שולח בכל בקשה את כל מה שנאסף עד כה).
 */
/**
 * מסלול יחיד המטפל בכל שלבי הבחירה, בעזרת שרשור read.
 *
 * *** ניווט דינמי בעץ (server/menuTree.js) בעומק בלתי מוגבל *** -
 * הפרמטרים n1, n2, n3... מצטברים ככל שהמאזין בוחר עומק נוסף בעץ
 * (בדיוק כמו topic/book/daf/amud הצטברו קודם - ימות שולח בכל בקשה
 * את כל מה שנאסף עד כה). ברגע שמגיעים לעלה שמקושר לתוכן קיים
 * (node.contentRef) - ממשיכים לתוך תהליך בחירת דף/עמוד הרגיל,
 * באמצעות params.daf/params.amud כמו קודם.
 */
const MAX_TREE_DEPTH = 20;

app.all('/api/ivr/main', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || params.Phone || 'unknown';

  try {
    const tree = await menuTree.getTree();

    // הליכה בעץ לפי n1, n2, ... - עד לצומת הנוכחי שבו המאזין נמצא
    let node = tree;
    let level = 1;
    for (; level <= MAX_TREE_DEPTH; level++) {
      const key = `n${level}`;
      if (params[key] === undefined) break;
      const idx = parseInt(params[key], 10) - 1;
      const child = (node.children || [])[idx];
      if (!child) {
        // בחירה לא תקינה - חוזרים לשאול את אותה רמה שוב
        const menu = (node.children || []).map((c, i) => `${i + 1}. ${c.name}`).join(', ');
        return res.send(
          proto.read([proto.textItem(`בחירה לא תקינה. ${menu}`)], key, { maxDigits: 2 })
        );
      }
      node = child;
    }

    // אם הגענו לצומת עם ילדים - מציגים תפריט ומבקשים את הרמה הבאה
    if (!node.leaf && node.children && node.children.length) {
      const menu = node.children.map((c, i) => `${i + 1}. ${c.name}`).join(', ');
      const prompt = level === 1 ? `ברוכים הבאים. ${menu}` : menu;
      return res.send(
        proto.read([proto.textItem(prompt)], `n${level}`, { maxDigits: 2 })
      );
    }

    // עלה בעץ - אם עדיין לא מקושר לתוכן אמיתי
    if (!node.contentRef) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem(`${node.name} - התוכן בבנייה, בקרוב אי"ה`)]),
        proto.goToFolder('/'),
      ));
    }

    // עלה מקושר לתוכן - ממשיכים לתהליך בחירת דף/עמוד הרגיל (בדיוק כמו קודם)
    const masechetId = node.contentRef;

    if (!params.daf) {
      return res.send(
        proto.read([proto.textItem('הקישו את מספר הדף המבוקש')], 'daf', { maxDigits: 3 })
      );
    }
    const daf = parseInt(params.daf, 10);
    if (!daf || daf < 2) {
      return res.send(
        proto.read([proto.textItem('מספר דף לא תקין. הקישו שוב')], 'daf', { maxDigits: 3 })
      );
    }

    if (!params.amud) {
      return res.send(
        proto.read([proto.textItem('לעמוד א הקישו 1, לעמוד ב הקישו 2')], 'amud', { maxDigits: 1 })
      );
    }
    const amud = params.amud === '2' ? 'b' : 'a';

    if (!contentIndex.amudExists(masechetId, daf, amud)) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem('העמוד המבוקש אינו קיים במערכת כרגע')]),
        proto.goToFolder('/'),
      ));
    }

    db.setCallState(phone, { masechet: masechetId, daf, amud, track: 'gemara', speed: 1.0 });
    const savedOffset = db.getPosition(phone, masechetId, daf, amud, 'gemara');
    const targetFolder = await playfileFolderFor(masechetId, daf, amud);

    return res.send(
      proto.goToFolderAndPlay(targetFolder, 'gemara', savedOffset)
    );
  } catch (err) {
    console.error(err);
    return res.send(proto.idListMessage([proto.textItem('אירעה שגיאה זמנית, נסו שוב')]));
  }
});

/**
 * ממיר (מסכת, דף, עמוד) לנתיב השלוחה הפיזי בימות שבו יושבים קבצי ה-wav
 * שהועלו ע"י ה-pipeline (ראה pipeline/uploadToYemot.js).
 * יש להתאים את הקידומת (למשל '/20') למספר השלוחה הראשית שהקציתם בימות.
 */
function playfileFolderFor(masechet, daf, amud) {
  return menuTree.getMasechetYemotFolder(masechet, daf, amud);
}

/**
 * שלוחת "תפריט מפרשים" משותפת - שלוחה אחת בלבד לכל המערכת (לא לכל
 * עמוד בנפרד). מגיעים אליה נייטיבית (go_to_folder, בלי שרת) כשלוחצים
 * 2 תוך כדי השמעת עמוד - ראה config/ext-api-commentary-menu.ini.
 *
 * משתמשת ב-read= בדיוק כמו השלוחה הראשית (מנגנון שכבר הוכח עובד),
 * במקום send_api ישיר מתוך playfile (שלא הוכח כאמין לבקשת read נוספת).
 * ההקשר (איזה עמוד המאזין נמצא בו כרגע) נשלף מ-db.getCallState לפי
 * מספר הטלפון - כבר נשמר שם בכל שלב קודם של הניווט/ההשמעה.
 */
app.all('/api/commentary-menu', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || params.Phone || 'unknown';

  try {
    const state = db.getCallState(phone);
    if (!state || !state.masechet) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem('שגיאה - לא נמצא הקשר לעמוד נוכחי')]),
        proto.goToFolder('..'),
      ));
    }

    if (!params.choice) {
      return res.send(
        proto.read([proto.textItem('לרש"י הקישו 1. לתוספות הקישו 2. לחזרה לגמרא הקישו 8')], 'choice', { maxDigits: 1 })
      );
    }

    let targetTrack = 'gemara';
    if (params.choice === '1') targetTrack = 'rashi';
    else if (params.choice === '2') targetTrack = 'tosafot';

    const remoteFolder = await menuTree.getMasechetYemotFolder(state.masechet, state.daf, state.amud);

    if (targetTrack !== 'gemara') {
      const trackFile = contentIndex.trackFile(state.masechet, state.daf, state.amud, targetTrack);
      if (!fs.existsSync(trackFile)) {
        return res.send(proto.chain(
          proto.idListMessage([proto.textItem('המפרש המבוקש אינו זמין לעמוד זה')]),
          proto.goToFolder('..'),
        ));
      }
    }

    const offset = db.getPosition(phone, state.masechet, state.daf, state.amud, targetTrack);
    db.setCallState(phone, { track: targetTrack });
    return res.send(proto.goToFolderAndPlay(remoteFolder, targetTrack, offset));
  } catch (err) {
    console.error(err);
    return res.send(proto.chain(
      proto.idListMessage([proto.textItem('אירעה שגיאה זמנית')]),
      proto.goToFolder('..'),
    ));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`שרת ימות-הש"ס מאזין על 0.0.0.0:${PORT}`);
});

module.exports = { playfileFolderFor };
