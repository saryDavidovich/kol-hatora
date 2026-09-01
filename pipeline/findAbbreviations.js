// pipeline/findAbbreviations.js
//
// סורק טקסט ומאתר ראשי תיבות/קיצורים (כמו ר', תוס', רש"י) לפי תבניות
// גרש/גרשיים עבריים, עם הקשר (10 מילים לפני/אחרי) להגהה.

const HEBREW_CHAR = '[\\u05D0-\\u05EA\\u0591-\\u05C7]';
const GERESH = '[\'\\u05F3]';
const GERSHAYIM = '["\\u05F4]';

const SINGLE_GERESH_RE = new RegExp(`${HEBREW_CHAR}+${GERESH}(?!${HEBREW_CHAR})`, 'g');
const GERSHAYIM_RE = new RegExp(`${HEBREW_CHAR}+${GERSHAYIM}${HEBREW_CHAR}+`, 'g');

function tokenizeWithPositions(text) {
  const tokens = [];
  const regex = /\S+/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function findAbbreviations(text) {
  const tokens = tokenizeWithPositions(text);
  const found = [];
  const seenSpans = new Set();

  function collect(regex) {
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      const key = `${start}-${end}`;
      if (seenSpans.has(key)) continue;
      seenSpans.add(key);

      const tokenIdx = tokens.findIndex((t) => t.start <= start && end <= t.end);
      const beforeTokens = tokenIdx >= 0 ? tokens.slice(Math.max(0, tokenIdx - 10), tokenIdx) : [];
      const afterTokens = tokenIdx >= 0 ? tokens.slice(tokenIdx + 1, tokenIdx + 11) : [];

      found.push({
        abbreviation: m[0],
        contextBefore: beforeTokens.map((t) => t.text).join(' '),
        contextAfter: afterTokens.map((t) => t.text).join(' '),
        charIndex: start,
        charEndIndex: end,
      });
    }
  }

  collect(SINGLE_GERESH_RE);
  collect(GERSHAYIM_RE);
  found.sort((a, b) => a.charIndex - b.charIndex);
  return found;
}

module.exports = { findAbbreviations };
