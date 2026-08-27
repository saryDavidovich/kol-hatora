// pipeline/ttsProvider.js
//
// חיבור ל-Google Cloud Text-to-Speech API (REST).
// מקור לתחביר הבקשה/תגובה: תיעוד רשמי של גוגל -
// https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
//
// שימו לב: ה-API דורש מפתח (API key) עם הרשאה ל-Text-to-Speech API,
// לא Bearer token. המפתח מועבר כפרמטר ב-query string, לא ב-header.
// התגובה היא JSON עם השדה audioContent שהוא האודיו מקודד ב-base64
// (לא קובץ בינארי ישיר) - צריך לפענח אותו לפני השמירה לדיסק.
//
// דרישה חשובה לפרויקט זה: טקסט הגמרא הוא ארמית + עברית עם מונחים הלכתיים
// ייחודיים. מנוע ה-TTS לא תמיד יודע לקרוא ארמית/ראשי תיבות נכון.
// PHONETIC_FIXES למטה הוא מילון תיקונים להרחבה הדרגתית תוך כדי עבודה.

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;
const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/**
 * מילון תיקונים פונטיים - להרחיב בהדרגה ככל שנתקלים בהגיות שגויות.
 * המפתח: הצורה הכתובה בטקסט. הערך: איך "לכתוב" את זה כדי שה-TTS יבטא נכון.
 */
const PHONETIC_FIXES = {
  "רש\"י": 'רשי',
  "תוד\"ה": 'תוספות דיבור המתחיל',
  "גמ'": 'גמרא',
  "תוס'": 'תוספות',
  // ... יש להוסיף בהתאם לצרכים שיתגלו בפועל תוך כדי בדיקת עמודים בממשק הניהול
};

function applyPhoneticFixes(text) {
  let result = text;
  for (const [from, to] of Object.entries(PHONETIC_FIXES)) {
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * שולח טקסט ל-Google Cloud TTS ושומר קובץ WAV בנתיב שצוין.
 * @param text     הטקסט להקראה
 * @param voice    שם הקול המדויק אצל גוגל (למשל 'he-IL-Wavenet-C') -
 *                 יש להריץ קודם את pipeline/listGoogleVoices.js כדי
 *                 לקבל רשימה אמיתית ומדויקת של הקולות הזמינים בחשבונכם.
 * @param outPath  נתיב שמירה מקומי
 */
async function synthesizeToFile(text, voice, outPath) {
  if (!GOOGLE_TTS_API_KEY) {
    throw new Error(
      'לא הוגדר GOOGLE_TTS_API_KEY ב-.env - יש ליצור מפתח API בפרויקט Google Cloud ' +
      '(עם Text-to-Speech API מופעל) לפני הרצת ה-pipeline.'
    );
  }

  const fixedText = applyPhoneticFixes(text);

  const resp = await axios.post(
    `${GOOGLE_TTS_URL}?key=${GOOGLE_TTS_API_KEY}`,
    {
      input: { text: fixedText },
      voice: { languageCode: 'he-IL', name: voice },
      // LINEAR16 = WAV גולמי (PCM) - נוח להמשך עיבוד ב-ffmpeg בשלב buildAudio.js
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  if (!resp.data || !resp.data.audioContent) {
    throw new Error('תגובה לא צפויה מ-Google TTS - חסר audioContent');
  }

  const audioBuffer = Buffer.from(resp.data.audioContent, 'base64');
  await fs.ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, audioBuffer);
  return outPath;
}

/** יוצר נתיב קובץ זמני ייחודי לקטע טקסט (לשימוש בזמן הרכבת עמוד שלם) */
function tempSegmentPath(tmpDir, index) {
  const hash = crypto.randomBytes(4).toString('hex');
  return path.join(tmpDir, `seg_${String(index).padStart(4, '0')}_${hash}.wav`);
}

/** מביא מגוגל את רשימת הקולות העבריים האמיתיים הזמינים בחשבון (בלי לנחש) */
async function listHebrewVoices() {
  if (!GOOGLE_TTS_API_KEY) {
    throw new Error('לא הוגדר GOOGLE_TTS_API_KEY ב-.env');
  }
  const resp = await axios.get('https://texttospeech.googleapis.com/v1/voices', {
    params: { key: GOOGLE_TTS_API_KEY, languageCode: 'he-IL' },
  });
  return resp.data.voices || [];
}

module.exports = {
  synthesizeToFile, applyPhoneticFixes, tempSegmentPath, PHONETIC_FIXES, listHebrewVoices,
};
