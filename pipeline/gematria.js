// pipeline/gematria.js
//
// המרת מספר לגימטריה (לשמות דפים בוויקיטקסט) ובחזרה. מטפל במקרים
// המיוחדים 15/16 (טו/טז, לא יה/יו - כדי לא "לכתוב" את שם ה').

const UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

function numberToGematria(num) {
  if (num === 15) return 'טו';
  if (num === 16) return 'טז';
  let n = num;
  let result = '';
  const hundreds = Math.floor(n / 100);
  n %= 100;
  const tens = Math.floor(n / 10);
  const units = n % 10;

  // מאות מעל 4 (ת) - שרשור של ת (400)
  let h = hundreds;
  while (h > 4) {
    result += 'ת';
    h -= 4;
  }
  result += HUNDREDS[h] || '';
  result += TENS[tens] || '';
  result += UNITS[units] || '';
  return result;
}

const GEMATRIA_VALUES = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
  'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400,
};

function gematriaToNumber(str) {
  let total = 0;
  for (const ch of String(str)) {
    total += GEMATRIA_VALUES[ch] || 0;
  }
  return total;
}

module.exports = { numberToGematria, gematriaToNumber };
