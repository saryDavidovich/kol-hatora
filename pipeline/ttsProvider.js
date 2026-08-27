// pipeline/ttsProvider.js
//
// שכבת הפשטה מעל שירות ה-TTS. ההגדרות המדויקות (endpoint, פורמט הבקשה,
// קולות זמינים) שונות בין ספקים (Azure Cognitive Services, Google Cloud TTS,
// ElevenLabs וכו') - יש להתאים את synthesizeToFile לספק שבחרתם.
//
// דרישה חשובה לפרויקט זה: טקסט הגמרא הוא ארמית + עברית עם מונחים הלכתיים
// ייחודיים. רוב מנועי ה-TTS העבריים לא "יודעים" לקרוא ארמית כהלכה או
// לבטא נכון ראשי תיבות (רש"י, תוד"ה וכו'). יש להשתמש ב-applyPhoneticFixes
// כדי להחיל מילון תיקונים לפני השליחה למנוע - ולהרחיב אותו תוך כדי עבודה.

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const TTS_API_URL = process.env.TTS_API_URL;
const TTS_API_KEY = process.env.TTS_API_KEY;

/**
 * מילון תיקונים פונטיים - להרחיב בהדרגה ככל שנתקלים בהגיות שגויות.
 * המפתח: הצורה הכתובה בטקסט. הערך: איך "לכתוב" את זה כדי שה-TTS יבטא נכון.
 */
const PHONETIC_FIXES = {
  "רש\"י": 'רשי',
  "תוד\"ה": 'תוספות דיבור המתחיל',
  "גמ'": 'גמרא',
  "תוס'": 'תוספות',
  // ... יש להוסיף בהתאם לצרכים שיתגלו בפועל
};

function applyPhoneticFixes(text) {
  let result = text;
  for (const [from, to] of Object.entries(PHONETIC_FIXES)) {
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * שולח טקסט לשירות ה-TTS ושומר קובץ אודיו (wav) בנתיב שצוין.
 * @param text     הטקסט להקראה
 * @param voice    שם/מזהה הקול (למשל 'he-IL-AvriNeural' ב-Azure)
 * @param outPath  נתיב שמירה מקומי
 */
async function synthesizeToFile(text, voice, outPath) {
  if (!TTS_API_URL) {
    throw new Error(
      'לא הוגדר TTS_API_URL ב-.env - יש לחבר ספק TTS ממשי לפני הרצת ה-pipeline. ' +
      'ראה הערות בראש קובץ זה.'
    );
  }

  const fixedText = applyPhoneticFixes(text);

  // דוגמה גנרית - יש להתאים בפועל למבנה הבקשה של הספק שבחרתם.
  const resp = await axios.post(
    TTS_API_URL,
    { text: fixedText, voice },
    {
      headers: { Authorization: `Bearer ${TTS_API_KEY}` },
      responseType: 'arraybuffer',
    }
  );

  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, resp.data);
  return outPath;
}

/** יוצר נתיב קובץ זמני ייחודי לקטע טקסט (לשימוש בזמן הרכבת עמוד שלם) */
function tempSegmentPath(tmpDir, index) {
  const hash = crypto.randomBytes(4).toString('hex');
  return path.join(tmpDir, `seg_${String(index).padStart(4, '0')}_${hash}.wav`);
}

module.exports = { synthesizeToFile, applyPhoneticFixes, tempSegmentPath, PHONETIC_FIXES };
