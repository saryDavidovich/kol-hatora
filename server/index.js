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
const cookieParser = require('cookie-parser');
const contentIndex = require('./contentIndex');
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
// הרלוונטיים לימות, כדי לא להציף את הלוג עם תעבורת ממשק הניהול)
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/') && Object.keys(req.body || {}).length) {
    console.log('  body:', JSON.stringify(req.body).slice(0, 500));
  }
  next();
});

app.use('/api/player', playerRoutes);

// --- ממשק ניהול (כניסה + עמוד עריכה) ---
app.post('/admin/api/login', express.json(), adminAuth.handleLogin);
app.post('/admin/api/logout', adminAuth.handleLogout);
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
app.all('/api/ivr/main', (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || params.Phone || 'unknown';

  try {
    const { topics } = contentIndex.loadTopicsIndex();
    if (!topics.length) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem('המערכת עדיין בבנייה. נסו שוב מאוחר יותר')]),
      ));
    }

    // --- שלב 1: בחירת נושא ---
    if (!params.topic) {
      const menu = topics.map((t, i) => `${i + 1}. ${t.name}`).join(', ');
      return res.send(
        proto.read([proto.textItem(`ברוכים הבאים. לבחירת נושא: ${menu}`)], 'topic', { maxDigits: 2 })
      );
    }
    const topic = topics[parseInt(params.topic, 10) - 1];
    if (!topic) {
      return res.send(
        proto.read([proto.textItem('בחירה לא תקינה. בחרו נושא שוב')], 'topic', { maxDigits: 2 })
      );
    }

    // --- שלב 2: בחירת ספר (מסכת) ---
    if (!params.book) {
      const menu = topic.books.map((b, i) => `${i + 1}. ${b.name}`).join(', ');
      return res.send(
        proto.read([proto.textItem(`בחרו ספר: ${menu}`)], 'book', { maxDigits: 2 })
      );
    }
    const book = topic.books[parseInt(params.book, 10) - 1];
    if (!book) {
      return res.send(
        proto.read([proto.textItem('בחירה לא תקינה. בחרו ספר שוב')], 'book', { maxDigits: 2 })
      );
    }

    // --- שלב 3: בחירת דף ---
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

    // --- שלב 4: בחירת עמוד ---
    if (!params.amud) {
      return res.send(
        proto.read([proto.textItem('לעמוד א הקישו 1, לעמוד ב הקישו 2')], 'amud', { maxDigits: 1 })
      );
    }
    const amud = params.amud === '2' ? 'b' : 'a';

    if (!contentIndex.amudExists(book.id, daf, amud)) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem('העמוד המבוקש אינו קיים במערכת כרגע')]),
        proto.goToFolder('/'),
      ));
    }

    // --- שלב 5: שמירת מצב + הפעלה בפועל ---
    db.setCallState(phone, { masechet: book.id, daf, amud, track: 'gemara', speed: 1.0 });
    const savedOffset = db.getPosition(phone, book.id, daf, amud, 'gemara');
    const targetFolder = playfileFolderFor(book.id, daf, amud);

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
  const dafPadded = String(daf).padStart(3, '0');
  return `/20/${masechet}/${dafPadded}/${amud}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`שרת ימות-הש"ס מאזין על 0.0.0.0:${PORT}`);
});

module.exports = { playfileFolderFor };
