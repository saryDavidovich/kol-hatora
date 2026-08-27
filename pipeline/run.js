// pipeline/run.js
//
// מריץ את כל שרשרת העיבוד עבור עמוד גמרא אחד: שליפה מוויקיטקסט -> TTS
// והרכבת אודיו -> יצירת ext.ini -> העלאה לימות.
// שימוש: node pipeline/run.js "בבא קמא" 2 a
//
// להרצה על מסכת שלמה - יש לעטוף קריאה זו בלולאה על טווח הדפים (ולשים
// לב ל-rate limiting מול שרתי ויקיטקסט, ולעלות בהדרגה כדי לבדוק איכות
// לפני שמריצים על היקף גדול).

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');

const { scrapeAmudAll } = require('./scrapeWikitext');
const { buildTrackAudio } = require('./buildAudio');
const { uploadAmud } = require('./uploadToYemot');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

// קולות TTS - להתאים לספק ולקולות שבחרתם (ראה pipeline/ttsProvider.js)
const VOICE_NORMAL = process.env.TTS_VOICE_NORMAL || 'he-IL-male-1';
const VOICE_BOLD = process.env.TTS_VOICE_BOLD || 'he-IL-male-2'; // קול שונה לכותרות/טקסט מודגש

function buildExtIni(templatePath, apiPlayerUrl) {
  const template = fs.readFileSync(templatePath, 'utf-8');
  return template.replace('https://YOUR-SERVER-DOMAIN.example.com/api/player/control', apiPlayerUrl);
}

async function processAmud(masechet, daf, amud) {
  console.log(`--- מעבד: ${masechet} דף ${daf} עמוד ${amud} ---`);

  const dafPadded = String(daf).padStart(3, '0');
  const localDir = path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, amud);
  await fs.ensureDir(localDir);

  // 1) שליפת העמוד השלם מוויקיטקסט (שליפה אחת מביאה גמרא+רש"י+תוספות יחד)
  const { title, tracks } = await scrapeAmudAll(masechet, daf, amud);

  const builtTracks = [];
  for (const trackName of ['gemara', 'rashi', 'tosafot']) {
    const data = tracks[trackName];
    if (data.missing || !data.segments.length) {
      console.warn(`  ${trackName}: לא נמצא תוכן בעמוד "${title}" - מדלג על track זה`);
      continue;
    }

    // 2) בניית קובץ האודיו + מפת הזמנים לכל track
    await buildTrackAudio({
      segments: data.segments,
      voiceNormal: VOICE_NORMAL,
      voiceBold: VOICE_BOLD,
      useBeeps: true,
      outDir: localDir,
      trackName,
    });
    builtTracks.push(trackName);
  }

  if (!builtTracks.length) {
    console.warn(`  אין אף track עם תוכן עבור ${masechet} ${daf}${amud} - מדלג לגמרי`);
    return;
  }

  // 3) כתיבת meta.json
  await fs.writeJson(path.join(localDir, 'meta.json'), {
    masechet, daf, amud, wikisourceTitle: title, tracks: builtTracks, generatedAt: new Date().toISOString(),
  }, { spaces: 2 });

  // 4) יצירת ext.ini מהתבנית
  const templatePath = path.join(__dirname, '..', 'config', 'ext-playfile-daf-template.ini');
  const apiPlayerUrl = process.env.API_PLAYER_URL || 'https://YOUR-SERVER-DOMAIN.example.com/api/player/control';
  const extIniContent = buildExtIni(templatePath, apiPlayerUrl);

  // 5) העלאה לימות (מושבת כברירת מחדל - יש להסיר את ההערה אחרי אימות ה-API)
  const remoteFolder = `/20/${masechet}/${dafPadded}/${amud}`;
  if (process.env.ENABLE_UPLOAD === 'yes') {
    await uploadAmud({ localDir, remoteFolder, extIniContent });
    console.log(`  הועלה בהצלחה ל-${remoteFolder}`);
  } else {
    await fs.writeFile(path.join(localDir, 'ext.ini'), extIniContent, 'utf-8');
    console.log(`  נוצר מקומית ב-${localDir} (ENABLE_UPLOAD!=yes, לא הועלה)`);
  }
}

if (require.main === module) {
  const [masechet, dafStr, amud] = process.argv.slice(2);
  if (!masechet || !dafStr || !amud) {
    console.log('שימוש: node pipeline/run.js "<מסכת>" <דף> <a|b>');
    process.exit(1);
  }
  processAmud(masechet, parseInt(dafStr, 10), amud)
    .then(() => console.log('הושלם.'))
    .catch((e) => { console.error('שגיאה:', e.message); process.exit(1); });
}

module.exports = { processAmud };
