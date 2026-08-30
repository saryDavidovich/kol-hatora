// pipeline/parseMasechetFile.js
//
// מפרק קובץ מסכת שלמה (HTML עם כותרות h1/h2, ראה דוגמה שנבדקה בפועל)
// לרשימת עמודים בפורמט הפנימי שלנו (masechet, daf, amud, segments).
//
// מבנה קובץ מאומת (לפי דוגמה אמיתית שנבדקה):
//   <h1>ברכות</h1>                    <- שם המסכת (פעם אחת, בתחילת הקובץ)
//   <h2>דף ב.</h2>                    <- תחילת עמוד א (נקודה בסוף)
//   ...תוכן הגמרא לעמוד הזה...
//   <h2>דף ב:</h2>                    <- תחילת עמוד ב (נקודתיים בסוף)
//   ...תוכן הגמרא לעמוד הזה...
//   <h2>דף ג.</h2>
//   ...
//
// טקסט מודגש מסומן ב-<big><strong>...</strong></big> - מומר ל-'''...'''
// (אותו תחביר שכבר בשימוש בשאר המערכת, כדי לעבוד עם אותו pipeline).
//
// הטקסט בקבצים האלה כבר מנוקד ומפוסק במלואו - לכן ה-pipeline לא מריץ
// עליו ניקוד/פיסוק אוטומטי בכלל (זה רק לרש"י/תוספות שממשיכים להגיע
// מוויקיטקסט כרגיל, בלי ניקוד מובנה).

const { gematriaToNumber } = require('./gematria');

/** ממיר <big><strong>טקסט</strong></big> ל-'''טקסט''' */
function convertBoldTags(html) {
  return html.replace(/<big>\s*<strong>([\s\S]*?)<\/strong>\s*<\/big>/g, "'''$1'''");
}

/** מסיר תגי HTML נותרים, ומפענח ישויות HTML נפוצות */
function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * מסיר מילים באנגלית (רצפי אותיות לטיניות) מהטקסט. שומר על סימני
 * פיסוק/ניקוד עבריים שנשארים סביב. משאיר רווח יחיד במקום שהיה.
 */
function stripEnglishWords(text) {
  return text
    .replace(/[A-Za-z]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** ממיר טקסט (עם סימוני ''' אחרי convertBoldTags) לרשימת segments, כמו splitBoldSegments */
function textToSegments(text) {
  const segments = [];
  const regex = /'''(.+?)'''/gs;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index).trim();
      if (plain) segments.push({ text: plain, bold: false });
    }
    const boldText = match[1].trim();
    if (boldText) segments.push({ text: boldText, bold: true });
    lastIndex = regex.lastIndex;
  }
  const rest = text.slice(lastIndex).trim();
  if (rest) segments.push({ text: rest, bold: false });

  return segments.filter((s) => s.text.length > 0);
}

/**
 * מפרק קובץ מסכת שלם.
 * @param fileContent  תוכן הקובץ הגולמי (HTML כפי שהוא)
 * @returns { masechetName, amudim: [{ daf, amud, segments, plainText }] }
 */
function parseMasechetFile(fileContent) {
  const h1Match = /<h1>([\s\S]*?)<\/h1>/.exec(fileContent);
  const masechetName = h1Match ? stripHtmlTags(h1Match[1]).trim() : null;

  // מוצאים את כל כותרות ה-h2 (מעברי עמוד) ואת המיקום שלהן בטקסט
  const headerRegex = /<h2>\s*דף\s+([א-ת]+)\s*([.:])\s*<\/h2>/g;
  const headers = [];
  let match;
  while ((match = headerRegex.exec(fileContent)) !== null) {
    const dafGematria = match[1];
    const amudSymbol = match[2]; // '.' = א, ':' = ב
    headers.push({
      daf: gematriaToNumber(dafGematria),
      amud: amudSymbol === '.' ? 'a' : 'b',
      startIndex: match.index,
      contentStartIndex: match.index + match[0].length,
    });
  }

  if (!headers.length) {
    throw new Error('לא נמצאו כותרות עמוד בקובץ (תבנית מצופה: <h2>דף X.</h2>) - בדקו את פורמט הקובץ');
  }

  const amudim = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const endIndex = i + 1 < headers.length ? headers[i + 1].startIndex : fileContent.length;
    const rawContent = fileContent.slice(h.contentStartIndex, endIndex);

    const withBoldMarkers = convertBoldTags(rawContent);
    const cleanText = stripEnglishWords(stripHtmlTags(withBoldMarkers));
    const segments = textToSegments(cleanText);

    amudim.push({
      daf: h.daf,
      amud: h.amud,
      segments,
      plainText: segments.map((s) => s.text).join(' '),
    });
  }

  return { masechetName, amudim };
}

module.exports = { parseMasechetFile, convertBoldTags, stripHtmlTags, stripEnglishWords, textToSegments };
