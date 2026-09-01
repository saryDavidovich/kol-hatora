// pipeline/scrapeGeneric.js
//
// שליפה גנרית מוויקיטקסט, מונעת-תבנית (לא ספציפית לתורה או לגמרא) -
// כדי לתמוך בכל ספר ובכל מפרש שהמנהל יגדיר (שולחן ערוך + ט"ז/מג"א/
// משנה ברורה, וכל דבר עתידי אחר), לא רק תנ"ך.
//
// תבנית שם עמוד היא מחרוזת עם placeholders:
//   {sefer}  - שם הספר (כפי שהוגדר בטופס הייבוא)
//   {item}   - שם הפריט הבודד (למשל שם פרק בגימטריה, או מספר סימן)
//
// לדוגמה: "רש\"י מנוקד על המקרא/ספר {sefer}/{item}" עם sefer="בראשית"
// ו-item="ו" -> "רש\"י מנוקד על המקרא/ספר בראשית/ו"
//
// *** אימות ***: רק תבניות התורה (ראה DEFAULT_TEMPLATES) נבדקו בפועל
// מול וויקיטקסט. תבנית חדשה (לשולחן ערוך וכו') חייבת להיבדק ידנית
// ע"י המנהל (לדוגמה עם כפתור "בדוק תבנית" בממשק) לפני ריצה על ספר שלם.

require('dotenv').config();
const axios = require('axios');
const { numberToGematria } = require('./gematria');
const PARASHA_PERAKIM = require('./parashaPerakim');

const WIKISOURCE_API = process.env.WIKISOURCE_API || 'https://he.wikisource.org/w/api.php';

/** תבניות ברירת מחדל מאומתות - לתורה בלבד. כל השאר דורש הזנה ידנית. */
const DEFAULT_TEMPLATES = {
  torah: {
    main: '{sefer} {item}',
    commentators: {
      'רש"י': 'רש"י מנוקד על המקרא/ספר {sefer}/{item}',
      'אונקלוס': 'תרגום אונקלוס (דפוס)/ספר {sefer}/{item}',
    },
  },
};

function fillTemplate(template, { sefer, item }) {
  return template.replace('{sefer}', sefer).replace('{item}', item);
}

async function fetchRawWikitext(pageTitle) {
  const resp = await axios.get(WIKISOURCE_API, {
    params: { action: 'parse', page: pageTitle, prop: 'wikitext', format: 'json', formatversion: 2 },
    headers: { 'User-Agent': 'yemot-shas-system-pipeline/1.0 (educational project)' },
    timeout: 20000,
  });
  if (resp.data.error) {
    throw new Error(`שגיאה בשליפת הדף "${pageTitle}": ${resp.data.error.info}`);
  }
  return resp.data.parse.wikitext;
}

/**
 * *** נדרש לדפי תנ"ך *** - שם התוכן האמיתי מגיע דרך תבנית מורכבת
 * (למשל {{דף של פרק תנך|...}}) שלא "מתרחבת" בוויקיטקסט הגולמי בכלל -
 * צריך את הגרסה המרונדרת (HTML) כדי לקבל את הטקסט בפועל. מנקה גם
 * "רעש" ניווט שמופיע לפני התוכן (ניווט בין פרקים, קישורי מהדורות).
 */
async function fetchRenderedText(pageTitle) {
  const resp = await axios.get(WIKISOURCE_API, {
    params: { action: 'parse', page: pageTitle, prop: 'text', format: 'json', formatversion: 2 },
    headers: { 'User-Agent': 'yemot-shas-system-pipeline/1.0 (educational project)' },
    timeout: 20000,
  });
  if (resp.data.error) {
    throw new Error(`שגיאה בשליפת הדף "${pageTitle}": ${resp.data.error.info}`);
  }
  const html = resp.data.parse.text;
  let text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

  // חיתוך "רעש" ניווט נפוץ שמופיע לפני התוכן האמיתי - מחפשים את הביטוי
  // "מהדורה מעומדת" שמסיים את שורת קישורי המהדורות, ולוקחים הכל אחריו
  const marker = 'מהדורה מעומדת';
  const idx = text.indexOf(marker);
  if (idx !== -1) {
    text = text.slice(idx + marker.length).trim();
  }
  return text;
}

/** המתנה קצרה בין בקשות - וויקיטקסט מחזיר 429 (rate limit) אם פוגעים מהר מדי */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** שליפה עם ניסיון חוזר אם מתקבל 429 (מכבד את retry-after אם קיים) */
async function fetchWithRetry(pageTitle, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchRenderedText(pageTitle);
    } catch (err) {
      const status = err.response && err.response.status;
      if (status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt((err.response.headers || {})['retry-after'], 10) || (attempt * 5);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw err;
    }
  }
}

/** שליפת עמוד בודד (ספר/מפרש-שאינו-תורה, מיפוי 1:1 בין פריט בעץ לעמוד בוויקיטקסט) */
async function fetchSingle(template, sefer, itemName) {
  const title = fillTemplate(template, { sefer, item: itemName });
  const plainText = await fetchWithRetry(title);
  return { title, plainText };
}

/**
 * שליפת פרשה שלמה (תורה בלבד) - מחברת את כל הפרקים שהפרשה חוצה
 * (לפי pipeline/parashaPerakim.js), עם המתנה קצרה בין כל שליפה כדי
 * לא לפגוע במגבלת הקצב של וויקיטקסט. התוצאה עשויה לכלול "עודף" בגבולות
 * (תחילת/סוף הפרק המשותף עם הפרשה השכנה) - מיועד לתיקון ידני בעורך.
 */
async function fetchTorahParasha(template, sefer, parashaName) {
  const range = (PARASHA_PERAKIM[sefer] || {})[parashaName];
  if (!range) {
    throw new Error(`לא ידוע טווח הפרקים עבור "${sefer}"/"${parashaName}" - בדקו את pipeline/parashaPerakim.js`);
  }
  const [fromPerek, toPerek] = range;

  const parts = [];
  const titlesFetched = [];
  for (let p = fromPerek; p <= toPerek; p++) {
    const itemGematria = numberToGematria(p);
    const title = fillTemplate(template, { sefer, item: itemGematria });
    const text = await fetchWithRetry(title);
    parts.push(text);
    titlesFetched.push(title);
    await sleep(600); // המתנה עדינה בין בקשות - וויקיטקסט רגיש למהירות
  }

  return {
    titles: titlesFetched,
    plainText: parts.join(' '),
    note: `כולל פרקים ${fromPerek}-${toPerek} במלואם - ייתכן עודף בתחילת/סוף מהפרשה השכנה, יש לבדוק ולתקן`,
  };
}

module.exports = {
  DEFAULT_TEMPLATES, fillTemplate, fetchSingle, fetchTorahParasha, fetchWithRetry, sleep,
};

// בדיקה ידנית: node pipeline/scrapeGeneric.js torah בראשית נח "רש\"י"
if (require.main === module) {
  const [mode, sefer, item, ...rest] = process.argv.slice(2);
  (async () => {
    if (mode === 'torah') {
      const template = rest[0] === 'main' || !rest.length
        ? DEFAULT_TEMPLATES.torah.main
        : DEFAULT_TEMPLATES.torah.commentators[rest[0]];
      if (!template) return console.log('מפרש לא מוכר. נסה: רש"י / אונקלוס / main');
      const result = await fetchTorahParasha(template, sefer, item);
      console.log('דפים שנשלפו:', result.titles);
      console.log('הערה:', result.note);
      console.log('--- 400 תווים ראשונים ---');
      console.log(result.plainText.slice(0, 400));
    } else {
      console.log('שימוש: node pipeline/scrapeGeneric.js torah <ספר> <פרשה> [מפרש]');
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
