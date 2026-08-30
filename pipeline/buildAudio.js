// pipeline/buildAudio.js
//
// לוקח רשימת קטעים (segments: [{text, bold}]) שהתקבלה מ-scrapeWikitext,
// הופך כל קטע לקובץ TTS (עם קול שונה לטקסט מודגש - למשל כותרות/ראשי דיבור),
// מוסיף צפצוף קצר לפני/אחרי קטעים מודגשים, מחבר הכל לקובץ WAV אחד,
// ובמקביל בונה "מפת זמנים" (timeline.json) שמתעדת איפה כל קטע מתחיל
// ומסתיים (באלפיות שנייה) - כדי שאפשר יהיה בעתיד להצמיד תכונות נוספות
// (כמו "קפיצה לפריט הבא/הקודם") אם ירצו להרחיב את המערכת.

const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { synthesizeToFile, tempSegmentPath } = require('./ttsProvider');
const { getDurationSeconds } = require('../server/audioEngine');

// Google Cloud TTS מגביל כל בקשה ל-5000 בייט (לא תווים!). עברית היא
// UTF-8 דו-בייטית לרוב, כך שבפועל זו מגבלה של כ-2,500 תווים עבריים.
// משאירים שולי ביטחון (4000 בייט) כדי לא לגעת בקצה בדיוק.
const MAX_TTS_BYTES = 4000;

/**
 * רשת ביטחון: מאלץ קובץ WAV לפורמט מדויק אחיד (8000Hz, מונו, PCM 16-bit) -
 * חייב להיות זהה בכל קובץ שמחוברים יחד (ffmpeg concat demuxer דורש
 * פרמטרים זהים בכל הקבצים, אחרת מקבלים עיוות/"גמגום" בזמן ההשמעה).
 * מריצים את זה גם אם ttsProvider כבר ביקש 8000Hz ישירות, כדי לכסות
 * מקרים שבהם ספק ה-TTS מתעלם מהבקשה עבור קול מסוים.
 */
async function normalizeToTargetFormat(filePath) {
  const normalizedPath = filePath.replace(/\.wav$/, '_norm.wav');
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-i', filePath, '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', normalizedPath,
    ], (err) => (err ? reject(err) : resolve()));
  });
  await fs.remove(filePath);
  await fs.move(normalizedPath, filePath);
}

/**
 * מפצל קטע טקסט ארוך למספר תת-קטעים, כל אחד מתחת למגבלת הבייטים של
 * Google TTS - תוך שמירה על שבירה בין מילים שלמות בלבד (לא באמצע מילה).
 */
function splitLongText(text, maxBytes = MAX_TTS_BYTES) {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return [text];

  const words = text.split(/(\s+)/); // שומר את המפרידים (רווחים) כדי לא לאבד אותם
  const chunks = [];
  let current = '';

  for (const word of words) {
    const candidate = current + word;
    if (Buffer.byteLength(candidate, 'utf-8') > maxBytes && current.trim()) {
      chunks.push(current.trim());
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      resolve(stdout);
    });
  });
}

/** יוצר קובץ ביפ קצר (0.15 שניה, טון 900Hz) אם עוד לא קיים */
async function ensureBeepFile(tmpDir) {
  const beepPath = path.join(tmpDir, '_beep.wav');
  if (await fs.pathExists(beepPath)) return beepPath;
  await run('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=900:duration=0.15',
    '-ac', '1', '-ar', '8000', beepPath,
  ]);
  return beepPath;
}

/**
 * @param opts.segments   [{text, bold}]
 * @param opts.voiceNormal  שם קול לטקסט רגיל
 * @param opts.voiceBold    שם קול לטקסט מודגש (או אותו קול + ביפים)
 * @param opts.useBeeps     האם להוסיף צפצוף סביב קטעים מודגשים (בנוסף/במקום קול שונה)
 * @param opts.outDir      תיקיית פלט (שם ייכתבו <trackName>.wav ו-<trackName>.timeline.json)
 * @param opts.trackName   'gemara' | 'rashi' | 'tosafot'
 */
async function buildTrackAudio(opts) {
  const {
    segments, voiceNormal, voiceBold, useBeeps = true, outDir, trackName,
  } = opts;

  await fs.ensureDir(outDir);
  const tmpDir = path.join(outDir, `_tmp_${trackName}`);
  await fs.ensureDir(tmpDir);

  const beepPath = useBeeps ? await ensureBeepFile(tmpDir) : null;
  const partFiles = [];   // רשימת קבצים לחיבור (concat)
  const timeline = [];    // { index, text, bold, startMs, endMs }
  let cursorMs = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const voice = seg.bold ? (voiceBold || voiceNormal) : voiceNormal;
    const subChunks = splitLongText(seg.text); // כמעט תמיד מערך של איבר אחד; מתפצל רק אם ארוך מדי

    if (seg.bold && useBeeps) {
      partFiles.push(beepPath);
      const beepDur = await getDurationSeconds(beepPath);
      cursorMs += beepDur * 1000;
    }

    for (let sub = 0; sub < subChunks.length; sub++) {
      const chunkText = subChunks[sub];
      const segPath = tempSegmentPath(tmpDir, i * 1000 + sub); // מפתח ייחודי גם עם תת-חלוקה
      await synthesizeToFile(chunkText, voice, segPath);
      await normalizeToTargetFormat(segPath);
      const durSec = await getDurationSeconds(segPath);

      timeline.push({
        index: i, subIndex: sub, text: chunkText, bold: seg.bold,
        startMs: Math.round(cursorMs), endMs: Math.round(cursorMs + durSec * 1000),
      });
      cursorMs += durSec * 1000;
      partFiles.push(segPath);
    }

    if (seg.bold && useBeeps) {
      partFiles.push(beepPath);
      const beepDur = await getDurationSeconds(beepPath);
      cursorMs += beepDur * 1000;
    }
  }

  // חיבור כל הקטעים לקובץ אחד באמצעות ffmpeg concat demuxer
  const listFile = path.join(tmpDir, 'concat_list.txt');
  const listContent = partFiles.map((p) => `file '${path.resolve(p)}'`).join('\n');
  await fs.writeFile(listFile, listContent, 'utf-8');

  const outWav = path.join(outDir, `${trackName}.wav`);
  await run('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', outWav,
  ]);

  await fs.writeJson(path.join(outDir, `${trackName}.timeline.json`), timeline, { spaces: 2 });

  // ניקוי קבצי ביניים (שומרים רק את קובץ ה-WAV הסופי ואת ה-timeline)
  await fs.remove(tmpDir);

  return { wavPath: outWav, timelinePath: path.join(outDir, `${trackName}.timeline.json`), durationMs: cursorMs };
}

module.exports = { buildTrackAudio, splitLongText };
