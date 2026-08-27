// pipeline/nikud.js
//
// חיבור לשירות הניקוד האוטומטי של דיקטה (Dicta) - חינמי.
// מקור לתחביר הבקשה: קוד PHP עובד שפורסם בפורום מפתחי ימות המשיח
// (https://f2.freeivr.co.il/topic/18461), שמשתמש ב-endpoint ובפרמטרים האלה.
//
// הערה: הפרמטר genre='rabbinic' הוא בחירה סבירה עבור טקסט גמרא/רש"י/תוספות
// (על סמך כך שבאתר nakdansimple.dicta.org.il מוזכר שה"נקדן האוטומטי" תומך
// ב"טקסטים רבניים - ספרות חז״ל, ספרות הראשונים"), אבל לא מצאתי תיעוד
// רשמי שמפרט את כל הערכים האפשריים לפרמטר genre. אם התוצאה לא מספיק
// מדויקת על טקסט תלמודי, כדאי לנסות גם genre='premodern' או לפנות לדיקטה
// לבירור הערך המדויק לספרות חז"ל.

const axios = require('axios');

const DICTA_NAKDAN_URL = process.env.DICTA_NAKDAN_URL
  || 'https://nakdan-u1-0.loadbalancer.dicta.org.il/api';

/**
 * שולח טקסט לא מנוקד ומחזיר טקסט מנוקד.
 * @param text  טקסט עברי/ארמי ללא ניקוד (או עם ניקוד חלקי)
 * @param genre 'rabbinic' (ברירת מחדל, מתאים לגמרא/רש"י/תוספות) | 'modern'
 */
async function addNikud(text, genre = 'rabbinic') {
  if (!text || !text.trim()) return text;

  const resp = await axios.post(
    DICTA_NAKDAN_URL,
    {
      task: 'nakdan',
      data: text,
      addmorph: true,
      keepmetagim: true,
      keepqq: false,
      nodageshdefmem: false,
      patachma: false,
      useTokenization: true,
      genre,
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  // תגובת ה-API היא מערך של "יחידות" (מילים/סימני פיסוק), כשלכל אחת
  // יש בד"כ שדה options עם האפשרות המנוקדת המובילה. מרכיבים בחזרה למשפט.
  const units = resp.data;
  if (!Array.isArray(units)) {
    throw new Error('תגובה לא צפויה משירות הניקוד - יש לבדוק את מבנה ה-JSON שחוזר');
  }

  return units
    .map((unit) => {
      if (unit.options && unit.options.length > 0) {
        // כל option הוא בד"כ [ניקוד, ניתוח דקדוקי] - לוקחים את הראשון (הכי סביר)
        const best = unit.options[0];
        return Array.isArray(best) ? best[0] : (best.w || best.word || unit.word || '');
      }
      return unit.word || '';
    })
    .join('')
    .trim();
}

module.exports = { addNikud };

// בדיקה ידנית: node pipeline/nikud.js "בראשית ברא אלהים את השמים ואת הארץ"
if (require.main === module) {
  const text = process.argv.slice(2).join(' ');
  if (!text) {
    console.log('שימוש: node pipeline/nikud.js "<טקסט לניקוד>"');
    process.exit(1);
  }
  addNikud(text).then((r) => console.log(r)).catch((e) => { console.error(e.message); process.exit(1); });
}
