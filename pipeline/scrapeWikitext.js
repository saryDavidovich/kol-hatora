// pipeline/scrapeWikitext.js
//
// שליפת תוכן דף גמרא מוויקיטקסט (he.wikisource.org).
//
// *** מבנה מאומת בפועל (לא ניחוש) *** - בדקתי ידנית מול he.wikisource.org:
// - שם העמוד הוא "<מסכת> <דף בגימטריה> <עמוד: א|ב>", למשל "ברכות ב א".
//   אין קידומת "בבלי/" ואין לוכסנים, ומספר הדף כתוב באותיות (גימטריה),
//   לא בספרות (למשל דף 15 -> "טו", לא "15").
// - גמרא, רש"י ותוספות **אינם דפים נפרדים** - כולם נמצאים באותו עמוד
//   ויקיטקסט אחד, מחולקים לפי כותרות פנימיות בתחביר MediaWiki:
//     == גמרא ==
//     == רש"י ==
//     == תוספות ==
//   ואחריהן עוד כותרות שלא רלוונטיות לנו (גליון הש"ס, הגהות הרש"ש,
//   עין משפט ונר מצוה, ראשונים נוספים) - אלה מדולגות אוטומטית כי הן
//   לא בין השמות שאנחנו מחפשים.
// דוגמה שנבדקה בפועל: https://he.wikisource.org/wiki/ברכות_ב_א

require('dotenv').config();
const axios = require('axios');
const { numberToGematria } = require('./gematria');

const WIKISOURCE_API = process.env.WIKISOURCE_API || 'https://he.wikisource.org/w/api.php';

/** בונה את שם עמוד הוויקיטקסט, למשל ("ברכות", 2, "a") -> "ברכות ב א" */
function buildPageTitle(masechet, daf, amud) {
  const dafGematria = numberToGematria(daf);
  const amudHeb = amud === 'a' ? 'א' : 'ב';
  return `${masechet} ${dafGematria} ${amudHeb}`;
}

/** שולף את תוכן הוויקיטקסט הגולמי של דף נתון */
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
 * מפצל את הוויקיטקסט המלא של העמוד לפי כותרות ברמה 2/3 (== כותרת ==),
 * ומחזיר מפה { שם_כותרת_מנוקה: תוכן }. תוכן שלפני הכותרת הראשונה
 * (אם יש - למשל שורות ניווט) מתעלמים ממנו.
 */
function splitIntoSections(wikitext) {
  const headerRegex = /^(={2,3})\s*([^=\n]+?)\s*\1\s*$/gm;
  const sections = {};
  let lastTitle = null;
  let lastIndex = 0;
  let match;

  while ((match = headerRegex.exec(wikitext)) !== null) {
    if (lastTitle !== null) {
      sections[lastTitle] = wikitext.slice(lastIndex, match.index).trim();
    }
    lastTitle = match[2].trim();
    lastIndex = headerRegex.lastIndex;
  }
  if (lastTitle !== null) {
    sections[lastTitle] = wikitext.slice(lastIndex).trim();
  }
  return sections;
}

/**
 * מפרק טקסט ויקי לרשימת קטעים { text, bold }.
 * מזהה טקסט מודגש בתחביר ''' ... ''' (שלוש גרשיים).
 * גם מנקה תבניות בסיסיות {{...}} וקישורים [[יעד|טקסט]] -> טקסט.
 */
function splitBoldSegments(wikitext) {
  let clean = wikitext
    .replace(/<ref[^>]*>.*?<\/ref>/gs, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '');

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

// שמות הכותרות בוויקיטקסט לכל track שלנו (יכולים להשתנות מעט בין עמודים -
// למשל רווחים/גרשיים - לכן ההשוואה למטה מתעלמת מגרשיים ורווחים כפולים)
const SECTION_NAMES = {
  gemara: ['גמרא'],
  rashi: ["רש\"י", 'רשי'],
  tosafot: ['תוספות'],
};

function normalizeSectionKey(title) {
  return title.replace(/["'׳]/g, '').replace(/\s+/g, ' ').trim();
}

/** שולף עמוד שלם ומפרק אותו לשלושת ה-track-ים */
async function scrapeAmudAll(masechet, daf, amud) {
  const title = buildPageTitle(masechet, daf, amud);
  const wikitext = await fetchRawWikitext(title);
  const sections = splitIntoSections(wikitext);

  // בונים מפה מנורמלת של הכותרות שבפועל התקבלו, כדי להתאים גם אם יש
  // הבדלים קטנים (גרשיים/רווחים) משמות הייחוס שלנו
  const normalizedSections = {};
  for (const [key, content] of Object.entries(sections)) {
    normalizedSections[normalizeSectionKey(key)] = content;
  }

  const result = { title, tracks: {} };
  for (const [track, possibleNames] of Object.entries(SECTION_NAMES)) {
    let content = null;
    for (const name of possibleNames) {
      const normalized = normalizeSectionKey(name);
      if (normalizedSections[normalized] !== undefined) {
        content = normalizedSections[normalized];
        break;
      }
    }
    if (content !== null) {
      const segments = splitBoldSegments(content);
      result.tracks[track] = { segments, plainText: segments.map((s) => s.text).join(' ') };
    } else {
      result.tracks[track] = { segments: [], plainText: '', missing: true };
    }
  }
  return result;
}

/** נוחות: שולף רק track בודד (עדיין מבצע שליפה של העמוד השלם ברקע) */
async function scrapeTrack(masechet, daf, amud, track) {
  const all = await scrapeAmudAll(masechet, daf, amud);
  const data = all.tracks[track];
  if (!data) throw new Error(`track לא מוכר: ${track}`);
  if (data.missing) {
    throw new Error(`הכותרת "${track}" לא נמצאה בעמוד "${all.title}" בוויקיטקסט`);
  }
  return { title: all.title, ...data };
}

/** תאימות לאחור - שקול ל-scrapeAmudAll אבל מחזיר רק את הגמרא, כמו הגרסה הישנה */
async function scrapeAmud(masechet, daf, amud) {
  const all = await scrapeAmudAll(masechet, daf, amud);
  return { title: all.title, segments: all.tracks.gemara.segments };
}

module.exports = {
  fetchRawWikitext, splitBoldSegments, splitIntoSections, buildPageTitle,
  scrapeAmud, scrapeTrack, scrapeAmudAll,
};

// הרצה ישירה לבדיקה: node pipeline/scrapeWikitext.js "ברכות" 2 a
if (require.main === module) {
  const [masechet, dafStr, amud] = process.argv.slice(2);
  if (!masechet || !dafStr || !amud) {
    console.log('שימוש: node pipeline/scrapeWikitext.js "<מסכת>" <דף> <a|b>');
    process.exit(1);
  }
  scrapeAmudAll(masechet, parseInt(dafStr, 10), amud)
    .then((r) => {
      console.log(`כותרת העמוד: ${r.title}`);
      for (const [track, data] of Object.entries(r.tracks)) {
        console.log(`\n=== ${track} ${data.missing ? '(לא נמצא!)' : `(${data.segments.length} קטעים)`} ===`);
        console.log(data.plainText.slice(0, 300));
      }
    })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
