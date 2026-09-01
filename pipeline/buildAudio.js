// pipeline/buildAudio.js
const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { synthesizeToFile } = require('./ttsProvider');

// Google Cloud TTS מגביל כל בקשה ל-5000 בייט (לא תווים!). עברית היא
// UTF-8 דו-בייטית לרוב, כך שבפועל זו מגבלה של כ-2,500 תווים עבריים.
// משאירים שולי ביטחון (4000 בייט) כדי לא לגעת בקצה בדיוק.
const MAX_TTS_BYTES = 4000;

function splitLongText(text) {
  if (Buffer.byteLength(text, 'utf-8') <= MAX_TTS_BYTES) return [text];
  const sentences = text.split(/(?<=[.!?:])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (Buffer.byteLength(candidate, 'utf-8') > MAX_TTS_BYTES) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * רשת ביטחון: מאלץ קובץ WAV לפורמט מדויק אחיד (8000Hz, מונו, PCM 16-bit) -
 * חייב להיות זהה בכל קובץ שמחוברים יחד (ffmpeg concat demuxer דורש
 * פרמטרים זהים בכל הקבצים, אחרת מקבלים עיוות/"גמגום").
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

async function ensureBeepFile(tmpDir) {
  const beepPath = path.join(tmpDir, '_beep.wav');
  if (await fs.pathExists(beepPath)) return beepPath;
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=900:duration=0.15',
      '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', beepPath,
    ], (err) => (err ? reject(err) : resolve()));
  });
  return beepPath;
}

async function concatWavFiles(fileList, outPath) {
  const listFilePath = outPath + '.filelist.txt';
  const content = fileList.map((f) => `file '${path.resolve(f)}'`).join('\n');
  await fs.writeFile(listFilePath, content);
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0', '-i', listFilePath,
      '-ac', '1', '-ar', '8000', '-acodec', 'pcm_s16le', outPath,
    ], (err) => (err ? reject(err) : resolve()));
  });
  await fs.remove(listFilePath);
}

/**
 * בונה קובץ אודיו לרצועה שלמה (segments עם דגל bold) - כל segment
 * מפוצל אם ארוך מדי, נשלח ל-TTS, וקטעי הדגשה מקבלים ביפ לפני ואחרי.
 */
async function buildTrackAudio({ segments, voiceNormal, voiceBold, useBeeps, outDir, trackName }) {
  await fs.ensureDir(outDir);
  const tmpRoot = process.env.TMP_ROOT || path.join(__dirname, '..', 'data', 'tmp');
  const tmpDir = path.join(tmpRoot, `build-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.ensureDir(tmpDir);

  const beepPath = useBeeps ? await ensureBeepFile(tmpRoot) : null;
  const partFiles = [];
  let partIndex = 0;

  for (const seg of segments) {
    const voice = seg.bold ? (voiceBold || voiceNormal) : voiceNormal;
    const chunks = splitLongText(seg.text);

    if (seg.bold && beepPath) partFiles.push(beepPath);
    for (const chunk of chunks) {
      const segPath = path.join(tmpDir, `seg-${partIndex++}.wav`);
      await synthesizeToFile(chunk, voice, segPath);
      await normalizeToTargetFormat(segPath);
      partFiles.push(segPath);
    }
    if (seg.bold && beepPath) partFiles.push(beepPath);
  }

  const outPath = path.join(outDir, `${trackName}.wav`);
  if (partFiles.length === 0) throw new Error('אין תוכן לבנייה (רצועה ריקה)');
  await concatWavFiles(partFiles, outPath);

  await fs.remove(tmpDir);
  return outPath;
}

module.exports = { buildTrackAudio, splitLongText, MAX_TTS_BYTES };
