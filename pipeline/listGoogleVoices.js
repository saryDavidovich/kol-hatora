// pipeline/listGoogleVoices.js
//
// שולף מ-Google Cloud TTS את הרשימה **האמיתית** של הקולות העבריים
// הזמינים בחשבונכם, כולל מגדר ואיכות (Standard/WaveNet/Neural2/Chirp3).
// זו הדרך הנכונה לבחור voice name - לא לנחש מהאינטרנט, כי הרשימה
// משתנה ומתעדכנת מצד גוגל.
//
// שימוש:
//   node pipeline/listGoogleVoices.js
//
// דורש GOOGLE_TTS_API_KEY מוגדר ב-.env.

require('dotenv').config();
const axios = require('axios');

const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

async function main() {
  if (!GOOGLE_TTS_API_KEY) {
    console.error('חסר GOOGLE_TTS_API_KEY ב-.env');
    process.exit(1);
  }

  const resp = await axios.get('https://texttospeech.googleapis.com/v1/voices', {
    params: { key: GOOGLE_TTS_API_KEY, languageCode: 'he-IL' },
  });

  const voices = resp.data.voices || [];
  if (!voices.length) {
    console.log('לא נמצאו קולות עבור he-IL - בדקו שה-API מופעל בפרויקט שלכם.');
    return;
  }

  console.log(`נמצאו ${voices.length} קולות עבריים זמינים בחשבונכם:\n`);
  console.log('שם הקול'.padEnd(28) + 'מגדר'.padEnd(10) + 'קצב דגימה טבעי');
  console.log('-'.repeat(55));
  for (const v of voices.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(v.name.padEnd(28) + v.ssmlGender.padEnd(10) + `${v.naturalSampleRateHertz} Hz`);
  }

  console.log('\nהעתיקו שם קול מהרשימה למעלה ל-TTS_VOICE_NORMAL ו-TTS_VOICE_BOLD ב-.env');
  console.log('טיפ: שמות עם "Wavenet" הם האיכותיים-והזולים ($4/מיליון), "Neural2"/"Chirp3" יקרים יותר ($16-30/מיליון).');
}

main().catch((e) => {
  console.error('שגיאה:', e.response ? JSON.stringify(e.response.data) : e.message);
  process.exit(1);
});
