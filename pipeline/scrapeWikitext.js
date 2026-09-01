// pipeline/scrapeWikitext.js
//
// שליפת עמוד גמרא (גמרא/רש"י/תוספות) מוויקיטקסט - הליבה של המערכת.
//
// *** עובדות מאומתות בפועל (לא ניחוש) ***:
// - שם עמוד: "<מסכת> <דף בגימטריה> <עמוד א|ב>" (למשל "ברכות ב א") -
//   בלי "תלמוד בבלי/" ובלי סלאשים.
// - מבנה הדף: כותרות == גמרא ==, == רש"י ==, == תוספות == (וכותרות
//   נוספות שלא רלוונטיות לנו: גליון הש"ס, הגהות הרש"ש, עין משפט...).
// - דפי "המשך" (כמו ג א) לפעמים אין להם כותרת == גמרא == נפרדת -
//   התוכן שלפני הכותרת הראשונה שייך לגמרא.
// - טקסט מודגש מסומן ב-'''...''' (ויקיטקסט רגיל).
// - קישורים [[יעד|תצוגה]] -> משאירים רק את התצוגה. [[יעד]] -> משאירים
//   את היעד.
// - תבניות {{...}} - כברירת מחדל שומרים את הפרמטר הראשון (בד"כ הטקסט
//   הרלוונטי), חוץ מתבניות "רעש בלבד" (NOISE_ONLY_TEMPLATES) שמוסרות
//   לגמרי.

require('dotenv').config();
const axios = require('axios');
const { numberToGematria } = require('./gematria');

const WIKISOURCE_API = process.env.WIKISOURCE_API || 'https://he.wikisource.org/w/api.php';

// תבניות שהן "רעש בלבד" (הערות עריכה, לא תוכן לקריאה) - מוסרות לגמרי
const NOISE_ONLY_TEMPLATES = ['הבהרה', 'לשכתב', 'מקורות', 'ציטוט', 'הערת עריכה', 'כותרת לעמוד בגמרא'];

function pageTitleFor(masechet, daf, amud) {
  const dafGem = numberToGematria(daf);
  const amudHeb = amud === 'a' ? 'א' : 'ב';
  return `${masechet} ${dafGem} ${amudHeb}`;
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

/** ממיר קישור ויקי [[יעד|תצוגה]] או [[יעד]] לטקסט תצוגה בלבד */
function stripWikiLinks(text) {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
}

/** מטפל בתבניות {{...}} - שומר פרמטר ראשון, מוריד תבניות רעש לגמרי */
function stripTemplates(text) {
  return text.replace(/\{\{([^{}]*)\}\}/g, (match, inner) => {
    const parts = inner.split('|');
    const templateName = parts[0].trim();
    if (NOISE_ONLY_TEMPLATES.some((noise) => templateName.includes(noise))) return '';
    return parts[1] !== undefined ? parts[1].trim() : '';
  });
}

/** מנקה הערות שוליים <ref>...</ref> ותגי "קטע" טכניים (סימון להטמעה, לא לקריאה) */
function stripRefs(text) {
  let t = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^/]*\/>/g, '');
  t = t.replace(/<קטע[^>]*\/>/g, '').replace(/<קטע[^>]*>[\s\S]*?<\/קטע>/g, '');
  t = t.replace(/<section[^>]*\/>/gi, '').replace(/<section[^>]*>[\s\S]*?<\/section>/gi, '');
  return t;
}

function cleanWikitext(text) {
  let t = stripRefs(text);
  t = stripTemplates(t);
  t = stripWikiLinks(t);
  t = t.replace(/<!--[\s\S]*?-->/g, ''); // הערות HTML
  t = t.replace(/\[עריכה\]/g, '');
  return t;
}

/**
 * מפצל טקסט (עם סימוני ''' ) לרשימת segments עם דגל bold - נדרש כדי
 * שה-TTS ידע להוסיף ביפ לפני/אחרי כל מילת דיבור-המתחיל.
 */
function splitBoldSegments(text) {
  const clean = cleanWikitext(text);
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
 * מחלץ סקציה בודדת (גמרא/רש"י/תוספות) מתוך הוויקיטקסט המלא, לפי
 * כותרת == שם ==. עבור "גמרא" - אם אין כותרת נפרדת (דפי המשך), לוקח
 * את כל מה שלפני הכותרת הראשונה שנמצאת בדף (כלומר תחילת הדף).
 */
function extractSection(wikitext, sectionName) {
  const headerRegex = /^==\s*([^=]+?)\s*==\s*$/gm;
  const headers = [];
  let m;
  while ((m = headerRegex.exec(wikitext)) !== null) {
    headers.push({ name: m[1].trim(), start: m.index, contentStart: m.index + m[0].length });
  }

  const target = headers.find((h) => h.name === sectionName);
  if (target) {
    const idx = headers.indexOf(target);
    const end = idx + 1 < headers.length ? headers[idx + 1].start : wikitext.length;
    return wikitext.slice(target.contentStart, end);
  }

  // אין כותרת בשם הזה - אם זו "גמרא" ואין שום כותרת גמרא בדף (דף המשך),
  // לוקחים את כל מה שלפני הכותרת הראשונה שקיימת בדף
  if (sectionName === 'גמרא' && headers.length > 0) {
    return wikitext.slice(0, headers[0].start);
  }
  if (sectionName === 'גמרא' && headers.length === 0) {
    return wikitext; // אין כותרות בכלל - כל הדף הוא גמרא
  }

  return null; // הסקציה הזו פשוט לא קיימת בדף הזה (רגיל לרש"י/תוספות בעמודים מסוימים)
}

/**
 * שולף עמוד גמרא שלם - שלוש הרצועות (גמרא/רש"י/תוספות) של דף+עמוד נתון.
 * @returns { tracks: { gemara: {...}, rashi: {...}, tosafot: {...} } }
 *          כל track: { missing: bool, segments: [...], plainText: string, error?: string }
 */
async function scrapeAmudAll(masechet, daf, amud) {
  const title = pageTitleFor(masechet, daf, amud);
  const wikitext = await fetchRawWikitext(title);
  // תווית הפניה טכנית שדולפת לפעמים לתחילת הגמרא (שריד ממנגנון ההטמעה
  // של ויקיטקסט) - למשל "ברכות א א" בתחילת עמוד ב. מסירים אותה רק אם
  // היא תואמת *בדיוק* לכותרת עמוד סביר (המסכת הנוכחית + מספר קטן ממנה),
  // כדי לא למחוק בטעות תוכן אמיתי שנראה דומה במקרה.
  const leakPattern = new RegExp(`^${masechet} [\\u05D0-\\u05EA]{1,3} [אב](?=\\s)`);

  const tracks = {};
  for (const [key, sectionName] of [['gemara', 'גמרא'], ['rashi', 'רש"י'], ['tosafot', 'תוספות']]) {
    const raw = extractSection(wikitext, sectionName);
    if (raw === null) {
      tracks[key] = { missing: true, segments: [], plainText: '' };
      continue;
    }
    let segments = splitBoldSegments(raw);
    if (segments.length && leakPattern.test(segments[0].text)) {
      segments[0] = { ...segments[0], text: segments[0].text.replace(leakPattern, '').trim() };
      if (!segments[0].text) segments.shift();
    }
    tracks[key] = { missing: false, segments, plainText: segments.map((s) => s.text).join(' ') };
  }

  return { title, tracks };
}

module.exports = {
  pageTitleFor, fetchRawWikitext, cleanWikitext, splitBoldSegments, extractSection, scrapeAmudAll,
  stripWikiLinks, stripTemplates,
};

// בדיקה ידנית: node pipeline/scrapeWikitext.js "ברכות" 2 a
if (require.main === module) {
  const [masechet, dafStr, amud] = process.argv.slice(2);
  if (!masechet || !dafStr || !amud) {
    console.log('שימוש: node pipeline/scrapeWikitext.js "<מסכת>" <דף> <a|b>');
    process.exit(1);
  }
  scrapeAmudAll(masechet, parseInt(dafStr, 10), amud).then((result) => {
    console.log('כותרת:', result.title);
    for (const key of ['gemara', 'rashi', 'tosafot']) {
      const t = result.tracks[key];
      console.log(`\n=== ${key} ${t.missing ? '(חסר)' : `(${t.segments.length} קטעים)`} ===`);
      if (!t.missing) console.log(t.plainText.slice(0, 300));
    }
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
