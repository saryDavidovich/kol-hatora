// pipeline/scrapeWikitext.js
//
// שליפת תוכן דף (מסכת/דף/עמוד) מוויקיטקסט (he.wikisource.org) ופירוקו
// לרשימת "קטעים" (segments) המבחינה בין טקסט רגיל לטקסט מודגש
// ('''כך''' בתחביר ויקי = יושמע בקול/צליל אחר, לפי buildAudio.js).
//
// הערה חשובה: המבנה המדויק של דפי הגמרא בוויקיטקסט (חלוקה לגמרא/רש"י/
// תוספות בתוך אותו דף, שימוש בתבניות {{...}} וכו') משתנה בין מסכתות,
// ולכן parseWikiPage כאן היא נקודת פתיחה שסביר שתצטרכו לכוונן לפי
// המסכת הספציפית שאתם עובדים איתה (יש להריץ ולבדוק ידנית על כמה דפים
// לפני הרצה על מסכת שלמה).

require('dotenv').config();
const axios = require('axios');

const WIKISOURCE_API = process.env.WIKISOURCE_API || 'https://he.wikisource.org/w/api.php';

/** שולף את תוכן הוויקיטקסט הגולמי של דף נתון בשם מלא (למשל "בבלי/בבא קמא/ב") */
async function fetchRawWikitext(pageTitle) {
  const resp = await axios.get(WIKISOURCE_API, {
    params: {
      action: 'parse',
      page: pageTitle,
      prop: 'wikitext',
      format: 'json',
      formatversion: 2,
    },
    headers: { 'User-Agent': 'yemot-shas-system-pipeline/1.0 (educational project)' },
  });

  if (resp.data.error) {
    throw new Error(`שגיאה בשליפת הדף "${pageTitle}": ${resp.data.error.info}`);
  }
  return resp.data.parse.wikitext;
}

/**
 * מפרק טקסט ויקי לרשימת קטעים { text, bold }.
 * מזהה טקסט מודגש בתחביר ''' ... ''' (שלוש גרשיים).
 * גם מנקה תבניות בסיסיות {{...}} וקישורים [[יעד|טקסט]] -> טקסט.
 */
function splitBoldSegments(wikitext) {
  // ניקוי בסיסי - קישורים, תבניות, הערות שוליים
  let clean = wikitext
    .replace(/<ref[^>]*>.*?<\/ref>/gs, '')      // הערות שוליים
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')             // תבניות פשוטות (לא מקוננות)
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')// [[יעד|טקסט מוצג]] -> טקסט מוצג
    .replace(/\[\[([^\]]*)\]\]/g, '$1')         // [[טקסט]] -> טקסט
    .replace(/<[^>]+>/g, '');                   // תגי HTML שנותרו

  const segments = [];
  const regex = /'''(.+?)'''/gs;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      const plain = clean.slice(lastIndex, match.index).trim();
      if (plain) segments.push({ text: plain, bold: false });
    }
    const boldText = match[1].trim();
    if (boldText) segments.push({ text: boldText, bold: true });
    lastIndex = regex.lastIndex;
  }
  const rest = clean.slice(lastIndex).trim();
  if (rest) segments.push({ text: rest, bold: false });

  return segments.filter((s) => s.text.length > 0);
}

/**
 * TODO להתאמה אישית: איך למצוא את שם העמוד המתאים לכל (מסכת, דף, עמוד).
 * מבנה נפוץ בוויקיטקסט (יש לוודא ולהתאים בפועל מול he.wikisource.org):
 *   "בבלי/בבא קמא/ב א"   (מסכת/דף עמוד)
 */
function buildPageTitle(masechet, daf, amud) {
  const amudHeb = amud === 'a' ? 'א' : 'ב';
  return `בבלי/${masechet}/${daf} ${amudHeb}`;
}

/**
 * *** דורש אימות *** - ניחוש סביר למבנה כותרת דפי רש"י בוויקיטקסט,
 * לא אומת בפועל. יש לבדוק ידנית על כמה עמודים בוויקיטקסט לפני שימוש.
 * ייתכן שהמבנה האמיתי שונה (תת-דף עם /רש"י, או section בתוך אותו דף
 * ולא כותרת נפרדת בכלל).
 */
function buildRashiTitle(masechet, daf, amud) {
  const amudHeb = amud === 'a' ? 'א' : 'ב';
  return `בבלי/${masechet}/${daf} ${amudHeb}/רש"י`;
}

/** *** דורש אימות *** - ראו הערה ב-buildRashiTitle */
function buildTosafotTitle(masechet, daf, amud) {
  const amudHeb = amud === 'a' ? 'א' : 'ב';
  return `בבלי/${masechet}/${daf} ${amudHeb}/תוספות`;
}

async function scrapeAmud(masechet, daf, amud) {
  const title = buildPageTitle(masechet, daf, amud);
  const wikitext = await fetchRawWikitext(title);
  const segments = splitBoldSegments(wikitext);
  return { title, segments };
}

/** שולף track ספציפי (gemara/rashi/tosafot). זורק שגיאה ברורה אם הדף לא נמצא */
async function scrapeTrack(masechet, daf, amud, track) {
  const titleBuilders = { gemara: buildPageTitle, rashi: buildRashiTitle, tosafot: buildTosafotTitle };
  const builder = titleBuilders[track];
  if (!builder) throw new Error(`track לא מוכר: ${track}`);

  const title = builder(masechet, daf, amud);
  const wikitext = await fetchRawWikitext(title);
  const segments = splitBoldSegments(wikitext);
  return { title, segments, plainText: segments.map((s) => s.text).join(' ') };
}

module.exports = {
  fetchRawWikitext, splitBoldSegments, buildPageTitle, buildRashiTitle, buildTosafotTitle,
  scrapeAmud, scrapeTrack,
};

// הרצה ישירה לבדיקה: node pipeline/scrapeWikitext.js "בבא קמא" 2 a
if (require.main === module) {
  const [masechet, dafStr, amud] = process.argv.slice(2);
  if (!masechet || !dafStr || !amud) {
    console.log('שימוש: node pipeline/scrapeWikitext.js "<מסכת>" <דף> <a|b>');
    process.exit(1);
  }
  scrapeAmud(masechet, parseInt(dafStr, 10), amud)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
