// pipeline/punctuation.js
//
// דיקטה (שירות הניקוד שלנו) לא מציעה כלי פיסוק תחבירי אמיתי (בדקתי -
// היא מתמחה בניקוד וזיהוי ציטוטים, לא בהוספת פסיקים/נקודות לפי תחביר
// המשפט). לכן לפיסוק אנחנו משתמשים ב-API של קלוד (Anthropic) - שמצוין
// במשימה הזו בדיוק: הוספת פיסוק טבעי לטקסט עברי/ארמי קלאסי.
//
// עיקרון בטיחות מרכזי: הפרומפט מורה במפורש "אל תשנה אף מילה, רק הוסף
// סימני פיסוק" - כדי לשמור על שלמות הטקסט התורני (בדיוק כמו שדרשת
// לגבי ניקוי התבניות - אסור לגעת בתוכן עצמו).

const axios = require('axios');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `אתה עוזר להוספת פיסוק לטקסטים תלמודיים/הלכתיים בעברית וארמית.
כללים מחייבים:
1. אסור לשנות, להוסיף, להשמיט או לנסח מחדש אף מילה מהטקסט המקורי.
2. מותר להוסיף אך ורק סימני פיסוק: פסיק, נקודה, נקודתיים, נקודה-פסיק, סימן שאלה, מקף, גרשיים סביב ציטוטים.
3. החזר אך ורק את הטקסט המפוסק, בלי הקדמה, בלי הסבר, בלי markdown.
4. אם אינך בטוח היכן להוסיף פיסוק - עדיף להימנע מלהוסיף שם, מאשר לנחש בצורה שעלולה לשנות משמעות הלכתית.`;

/**
 * מוסיף פיסוק לטקסט, תוך שמירה קפדנית על כל מילה מקורית.
 * זורק שגיאה ברורה אם המפתח לא מוגדר - כדי שהקורא לפונקציה יידע
 * להחליט אם להמשיך בלי פיסוק או לעצור.
 */
async function addPunctuation(text) {
  if (!text || !text.trim()) return text;
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY לא מוגדר ב-.env - פיסוק אוטומטי דורש מפתח API של Anthropic');
  }

  const resp = await axios.post(
    ANTHROPIC_API_URL,
    {
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `הוסף פיסוק לטקסט הבא:\n\n${text}` }],
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      timeout: 60000,
    }
  );

  const content = resp.data.content;
  if (!Array.isArray(content) || !content[0] || !content[0].text) {
    throw new Error('תגובה לא צפויה מ-Anthropic API');
  }
  return content[0].text.trim();
}

module.exports = { addPunctuation };

// בדיקה ידנית: node pipeline/punctuation.js "טקסט לדוגמה בלי פיסוק כלל"
if (require.main === module) {
  const text = process.argv.slice(2).join(' ');
  if (!text) {
    console.log('שימוש: node pipeline/punctuation.js "<טקסט>"');
    process.exit(1);
  }
  addPunctuation(text).then((r) => console.log(r)).catch((e) => { console.error(e.message); process.exit(1); });
}
