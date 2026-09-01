// pipeline/ttsProvider.js
require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');

const GOOGLE_TTS_URL = process.env.GOOGLE_TTS_URL || 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

/** תיקונים פונטיים קלים - אפשר להרחיב לפי צורך */
function applyPhoneticFixes(text) {
  return text;
}

async function synthesizeToFile(text, voice, outPath) {
  if (!GOOGLE_TTS_API_KEY) throw new Error('לא הוגדר GOOGLE_TTS_API_KEY');
  const fixedText = applyPhoneticFixes(text);

  let resp;
  try {
    resp = await axios.post(
      `${GOOGLE_TTS_URL}?key=${GOOGLE_TTS_API_KEY}`,
      {
        input: { text: fixedText },
        voice: { languageCode: 'he-IL', name: voice },
        // LINEAR16 = WAV גולמי (PCM). *** קצב הדגימה חייב להיות זהה
        // בדיוק לכל שאר הקבצים שמחוברים יחד בהמשך (קובץ הביפ, הפלט
        // הסופי - שניהם 8000Hz) *** - אחרת ffmpeg concat demuxer מייצר
        // עיוות/"גמגום" חמור. (נבדק ואומת בעבר).
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000 },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.error
      ? err.response.data.error.message : err.message;
    throw new Error(`TTS נכשל: ${detail}`);
  }

  const audioBuffer = Buffer.from(resp.data.audioContent, 'base64');
  await fs.writeFile(outPath, audioBuffer);
}

async function listHebrewVoices() {
  const resp = await axios.get('https://texttospeech.googleapis.com/v1/voices', {
    params: { key: GOOGLE_TTS_API_KEY, languageCode: 'he-IL' },
    timeout: 15000,
  });
  return (resp.data.voices || []).filter((v) => v.languageCodes.includes('he-IL'));
}

module.exports = { synthesizeToFile, listHebrewVoices };
