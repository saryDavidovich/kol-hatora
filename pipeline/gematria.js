// pipeline/gematria.js
//
// ממיר מספר (2-999) לייצוג בגימטריה עברית, כפי שוויקיטקסט משתמש בו
// בשמות דפי הגמרא (למשל 2 -> "ב", 15 -> "טו", 116 -> "קטז").
// כולל את החריגים המקובלים: 15 ו-16 נכתבים כ"טו"/"טז" ולא כ"יה"/"יו",
// כדי להימנע מכתיבת צירופים שנראים כמו שם ה'.

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/** ממיר מספר שלם (1-999) לגימטריה עברית, כמחרוזת בלי גרשיים */
function numberToGematria(num) {
  if (!Number.isInteger(num) || num < 1 || num > 999) {
    throw new Error(`numberToGematria תומך רק במספרים 1-999, קיבל: ${num}`);
  }

  let n = num;
  let result = '';

  const hundreds = Math.floor(n / 100);
  n %= 100;
  // מעל 400 (ת) ממשיכים לצרף עוד ת' (תת = 800 וכו') - נדיר בדפי גמרא, אבל למען השלמות:
  result += 'ת'.repeat(Math.floor(hundreds / 4));
  result += HUNDREDS[hundreds % 4];

  // החריגים 15/16 בתוך כל "מאה" (למשל 115 -> קטו, לא קיה)
  const remainder = n;
  if (remainder === 15) {
    result += 'טו';
  } else if (remainder === 16) {
    result += 'טז';
  } else {
    const tens = Math.floor(remainder / 10);
    const ones = remainder % 10;
    result += TENS[tens];
    result += ONES[ones];
  }

  return result;
}

/** ההפך - ממיר מחרוזת גימטריה למספר (שימושי לבדיקות/דיבוג) */
function gematriaToNumber(str) {
  const values = {
    א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9,
    י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90,
    ק: 100, ר: 200, ש: 300, ת: 400,
  };
  return [...str].reduce((sum, ch) => sum + (values[ch] || 0), 0);
}

module.exports = { numberToGematria, gematriaToNumber };

// בדיקה ידנית: node pipeline/gematria.js
if (require.main === module) {
  const tests = [2, 3, 9, 10, 11, 14, 15, 16, 17, 20, 40, 63, 100, 115, 116, 119, 176];
  for (const n of tests) {
    console.log(`${n} -> ${numberToGematria(n)}`);
  }
}
