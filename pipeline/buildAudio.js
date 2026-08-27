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

    if (seg.bold && useBeeps) {
      partFiles.push(beepPath);
      const beepDur = await getDurationSeconds(beepPath);
      cursorMs += beepDur * 1000;
    }

    const segPath = tempSegmentPath(tmpDir, i);
    await synthesizeToFile(seg.text, voice, segPath);
    const durSec = await getDurationSeconds(segPath);

    timeline.push({
      index: i, text: seg.text, bold: seg.bold,
      startMs: Math.round(cursorMs), endMs: Math.round(cursorMs + durSec * 1000),
    });
    cursorMs += durSec * 1000;
    partFiles.push(segPath);

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

module.exports = { buildTrackAudio };
