// pipeline/scrapeTanach.js
//
// שליפת תוכן תנ"ך מוויקיטקסט, מאורגן לפי פרשה - *** מבנה מאומת בפועל ***
// (לא כמו הגמרא: כאן כל "ספר" בוויקיטקסט מפוצל לפי פרשה, כולל הטקסט
// הראשי עצמו, ולא רק לפי פרק):
//
//   טקסט ראשי:  "פרשת <שם הפרשה>"           (למשל "פרשת נח")
//   רש"י:       "רש"י מנוקד על המקרא/ספר <ספר>/פרשת <פרשה>"
//   אונקלוס:    "תרגום אונקלוס (דפוס)/ספר <ספר>/פרשת <פרשה>"
//
// לא מאומת: יתכן שלטקסט הראשי צריך את הסיומת "/טעמים" (למשל
// "פרשת נח/טעמים") אם הדף הרגיל לא קיים - הקוד מנסה קודם בלי הסיומת,
// ורק אם נכשל מנסה עם הסיומת, ומדווח בבירור איזה מהם הצליח.

require('dotenv').config();
const axios = require('axios');
const { splitBoldSegments } = require('./scrapeWikitext');

const WIKISOURCE_API = process.env.WIKISOURCE_API || 'https://he.wikisource.org/w/api.php';

/**
 * רשימת המפרשים הידועים ותבנית שם העמוד שלהם בוויקיטקסט. *** רק
 * רש"י ואונקלוס מאומתים בפועל *** (נבדקו מול עמודים אמיתיים). מפרש
 * שמוסיפים כאן בלי אימות עלול להיכשל בשקט אם התבנית לא מדויקת - יש
 * לבדוק ידנית לפני שסומכים על מפרש חדש.
 */
const COMMENTATOR_REGISTRY = {
  'רש"י': {
    verified: true,
    titleFor: (sefer, parasha) => `רש"י מנוקד על המקרא/ספר ${sefer}/פרשת ${parasha}`,
  },
  'אונקלוס': {
    verified: true,
    titleFor: (sefer, parasha) => `תרגום אונקלוס (דפוס)/ספר ${sefer}/פרשת ${parasha}`,
  },
};

async function fetchRawWikitext(pageTitle) {
  const resp = await axios.get(WIKISOURCE_API, {
    params: { action: 'parse', page: pageTitle, prop: 'wikitext', format: 'json', formatversion: 2 },
    headers: { 'User-Agent': 'yemot-shas-system-pipeline/1.0 (educational project)' },
  });
  if (resp.data.error) {
    throw new Error(`שגיאה בשליפת הדף "${pageTitle}": ${resp.data.error.info}`);
  }
  return resp.data.parse.wikitext;
}

/** מנקה סימוני עלייה כמו [לוי]/[ישראל]/[מפטירה] - הערות ניווט, לא טקסט לקריאה */
function stripAliyahMarkers(text) {
  return text.replace(/\[(לוי|ישראל|כהן|שני|שלישי|רביעי|חמישי|שישי|שביעי|מפטיר|מפטירה)\]/g, ' ');
}

/** שולף את הטקסט הראשי (המקרא) של פרשה נתונה */
async function fetchParashaMainText(parasha) {
  const attempts = [`פרשת ${parasha}`, `פרשת ${parasha}/טעמים`];
  let lastError;
  for (const title of attempts) {
    try {
      const wikitext = await fetchRawWikitext(title);
      const clean = stripAliyahMarkers(wikitext);
      const segments = splitBoldSegments(clean);
      return { title, segments, plainText: segments.map((s) => s.text).join(' ') };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`לא נמצא טקסט ראשי לפרשה "${parasha}" (ניסיתי: ${attempts.join(', ')}): ${lastError.message}`);
}

/** שולף מפרש נתון (מתוך הרשימה הידועה) לפרשה נתונה */
async function fetchParashaCommentary(sefer, parasha, commentatorName) {
  const entry = COMMENTATOR_REGISTRY[commentatorName];
  if (!entry) {
    throw new Error(`המפרש "${commentatorName}" לא ברשימה הידועה - יש להוסיף אותו ל-COMMENTATOR_REGISTRY אחרי אימות ידני`);
  }
  const title = entry.titleFor(sefer, parasha);
  const wikitext = await fetchRawWikitext(title);
  const clean = stripAliyahMarkers(wikitext);
  const segments = splitBoldSegments(clean);
  return { title, segments, plainText: segments.map((s) => s.text).join(' '), verified: entry.verified };
}

module.exports = { fetchParashaMainText, fetchParashaCommentary, COMMENTATOR_REGISTRY, stripAliyahMarkers };

// בדיקה ידנית: node pipeline/scrapeTanach.js "בראשית" "נח" "רש\"י" "אונקלוס"
if (require.main === module) {
  const [sefer, parasha, ...commentators] = process.argv.slice(2);
  if (!sefer || !parasha) {
    console.log('שימוש: node pipeline/scrapeTanach.js "<ספר>" "<פרשה>" ["<מפרש1>" "<מפרש2>" ...]');
    process.exit(1);
  }
  (async () => {
    const main = await fetchParashaMainText(parasha);
    console.log(`=== טקסט ראשי (${main.title}) ===`);
    console.log(main.plainText.slice(0, 300));
    for (const c of commentators) {
      try {
        const com = await fetchParashaCommentary(sefer, parasha, c);
        console.log(`\n=== ${c} (${com.title}) ===`);
        console.log(com.plainText.slice(0, 300));
      } catch (err) {
        console.log(`\n=== ${c}: שגיאה - ${err.message} ===`);
      }
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
