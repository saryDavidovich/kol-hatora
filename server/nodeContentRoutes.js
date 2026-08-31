// server/nodeContentRoutes.js
//
// API לעריכת תוכן צומת-קובץ גנרי בעץ (לא קשור למבנה הקשיח של דף/עמוד
// גמרא). כל צומת יכול להכיל תוכן ראשי + תתי-תוכן, כל אחד עם קישור
// מקור אופציונלי משלו. משתמש באותם pipeline-ים שכבר קיימים (ניקוד,
// פיסוק, זיהוי ראשי תיבות, בניית TTS, העלאה לימות) - רק במסלול שונה
// שלא דורש מבנה דף/עמוד.

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const nodeContent = require('./nodeContent');
const menuTree = require('./menuTree');
const jobs = require('./jobs');
const settings = require('./settings');
const { addNikud } = require('../pipeline/nikud');
const { addPunctuation } = require('../pipeline/punctuation');
const { findAbbreviations } = require('../pipeline/findAbbreviations');
const { convertBoldTags, stripHtmlTags, stripEnglishWords } = require('../pipeline/parseMasechetFile');
const { splitBoldSegments } = require('../pipeline/scrapeWikitext');
const { buildTrackAudio } = require('../pipeline/buildAudio');
const { uploadAmud } = require('../pipeline/uploadToYemot');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
const BOLD_MARK_PLACEHOLDER = '\u0001BOLD\u0001';
const protectBold = (t) => t.split("'''").join(BOLD_MARK_PLACEHOLDER);
const restoreBold = (t) => t.split(BOLD_MARK_PLACEHOLDER).join("'''");

router.use(express.json({ limit: '2mb' }));

// --- קריאה/עדכון תוכן ---
router.get('/:nodeId', async (req, res) => {
  res.json(await nodeContent.getContent(req.params.nodeId));
});

router.post('/:nodeId/main', async (req, res) => {
  const { text, sourceUrl, name } = req.body;
  res.json(await nodeContent.updateMain(req.params.nodeId, { text, sourceUrl, name }));
});

router.post('/:nodeId/sub', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'חסר שם' });
  res.json(await nodeContent.addSub(req.params.nodeId, name.trim()));
});

router.post('/:nodeId/sub/:subId', async (req, res) => {
  const { text, sourceUrl, name } = req.body;
  try {
    res.json(await nodeContent.updateSub(req.params.nodeId, req.params.subId, { text, sourceUrl, name }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:nodeId/sub/:subId', async (req, res) => {
  await nodeContent.deleteSub(req.params.nodeId, req.params.subId);
  res.json({ ok: true });
});

// --- העלאת קובץ טקסט לתוך תוכן ראשי או תת-תוכן ---
router.post('/:nodeId/upload-file', upload.single('file'), async (req, res) => {
  const { target } = req.body; // 'main' או subId
  if (!req.file) return res.status(400).json({ error: 'לא צורף קובץ' });

  try {
    const raw = req.file.buffer.toString('utf-8');
    const withBold = convertBoldTags(raw);
    const clean = stripEnglishWords(stripHtmlTags(withBold));

    if (target === 'main') {
      await nodeContent.updateMain(req.params.nodeId, { text: clean });
    } else {
      await nodeContent.updateSub(req.params.nodeId, target, { text: clean });
    }
    res.json({ ok: true, text: clean });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- ניקוד (חינם, דיקטה) - מגן על סימוני ''' כמו בשאר המערכת ---
router.post('/:nodeId/nikud', async (req, res) => {
  const { text, genre } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const result = await addNikud(protectBold(text), genre || 'rabbinic');
    res.json({ text: restoreBold(result) });
  } catch (err) {
    res.status(502).json({ error: `שירות הניקוד נכשל: ${err.message}` });
  }
});

// --- פיסוק (Claude API, בתשלום) ---
router.post('/:nodeId/punctuate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const result = await addPunctuation(protectBold(text));
    res.json({ text: restoreBold(result) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- סריקת ראשי תיבות על כל הטקסטים בצומת (ראשי + תתי-תוכן) ---
router.post('/:nodeId/scan-abbreviations', async (req, res) => {
  const content = await nodeContent.getContent(req.params.nodeId);
  const results = {};
  results.main = findAbbreviations(content.mainContent.text || '');
  for (const sub of content.subContents) {
    results[sub.id] = findAbbreviations(sub.text || '');
  }
  res.json(results);
});

// --- בנייה (TTS) לתוכן הראשי + כל תתי-התוכן ---
router.post('/:nodeId/build', async (req, res) => {
  const { nodeId } = req.params;

  const jobId = jobs.runAsJob(async (progress) => {
    const content = await nodeContent.getContent(nodeId);
    const { voiceNormal, voiceBold } = await settings.getVoices();
    if (!voiceNormal) throw new Error('לא נבחר קול ברירת מחדל - עברו ל-⚙️ הגדרות קול קודם');

    const tree = await menuTree.getTree();
    const yemotPath = menuTree.getYemotPath(tree, nodeId);
    if (!yemotPath || !yemotPath.length) throw new Error('לא נמצא נתיב לצומת הזה בעץ');

    const outDir = path.join(CONTENT_ROOT, 'node-audio', nodeId);
    await fs.ensureDir(outDir);

    const tracks = [{ name: 'main', text: content.mainContent.text }, ...content.subContents.map((s) => ({ name: s.id, text: s.text }))];
    const builtTracks = [];
    let done = 0;

    for (const t of tracks) {
      if (!t.text || !t.text.trim()) { done++; continue; }
      progress(Math.round((done / tracks.length) * 100), `בונה ${t.name} (${done + 1}/${tracks.length})...`);
      const segments = splitBoldSegments(t.text);
      await buildTrackAudio({
        segments, voiceNormal, voiceBold, useBeeps: true, outDir, trackName: t.name,
      });
      builtTracks.push(t.name);
      done++;
    }

    await fs.writeJson(path.join(outDir, 'meta.json'), {
      nodeId, yemotPath, tracks: builtTracks, generatedAt: new Date().toISOString(),
    }, { spaces: 2 });

    progress(100, `הושלם - נבנו ${builtTracks.length} רצועות`);
    return { builtTracks, outDir };
  });

  res.json({ jobId });
});

// --- האזנה לתוצאה שנבנתה ---
router.get('/:nodeId/audio/:track', async (req, res) => {
  const filePath = path.join(CONTENT_ROOT, 'node-audio', req.params.nodeId, `${req.params.track}.wav`);
  if (!(await fs.pathExists(filePath))) return res.status(404).json({ error: 'הקובץ עדיין לא נבנה' });
  res.type('audio/wav');
  fs.createReadStream(filePath).pipe(res);
});

// --- העלאה לימות - נתיב מספרי לפי מיקום הצומת בעץ, בלי חלוקת דף/עמוד ---
router.post('/:nodeId/upload', async (req, res) => {
  const { nodeId } = req.params;

  const jobId = jobs.runAsJob(async (progress) => {
    const tree = await menuTree.getTree();
    const yemotPath = menuTree.getYemotPath(tree, nodeId);
    if (!yemotPath || !yemotPath.length) throw new Error('לא נמצא נתיב לצומת הזה בעץ');

    const localDir = path.join(CONTENT_ROOT, 'node-audio', nodeId);
    if (!(await fs.pathExists(localDir))) throw new Error('יש לבנות את התוכן קודם (כפתור בנייה)');

    // ext.ini - פקדי ניווט נייטיביים, ובנוסף תפריט "אפשרויות נוספות"
    // הילידי (מקש *) עם מיפוי דינמי: מקש 1 עד מספר תתי-התוכן בפועל
    // (עד 7 - מגבלת הקשה בודדת), מקש 8 = חזרה לתוכן הראשי
    const content = await nodeContent.getContent(nodeId);
    const subCount = Math.min(content.subContents.length, 7);
    const moreALines = [];
    for (let i = 1; i <= subCount; i++) {
      moreALines.push(`control_play_moreA${i}=send_api`);
    }
    if (content.subContents.length > 0) {
      moreALines.push('control_play_moreA8=send_api'); // חזרה לתוכן הראשי
    }

    const extIniContent = [
      'type=playfile',
      'listening_mark_no_check_for_key_options=minus,plus',
      'control_play1=seconds_minus', 'seconds_minus_amount=5000',
      'control_play3=seconds_plus', 'seconds_plus_amount=5000',
      'control_play4=minut_minus', 'minut_minus_amount1=180000',
      'control_play6=minut_plus', 'minut_plus_amount1=180000',
      'control_play7=change_playback_speed_minus',
      'control_play9=change_playback_speed_plus', 'save_change_speed=yes',
      'control_play5=wait', 'control_play_wait_time_max=600',
      ...moreALines,
      `api_link=${process.env.API_PLAYER_URL || 'https://YOUR-SERVER-DOMAIN.example.com/api/player/control'}`,
      'api_url_post=yes',
    ].join('\n');

    const remoteFolder = `/${yemotPath.join('/')}`;
    progress(30, `מעלה ל-${remoteFolder}...`);
    await uploadAmud({ localDir, remoteFolder, extIniContent });
    progress(100, 'הועלה בהצלחה');
    return { remoteFolder };
  });

  res.json({ jobId });
});

module.exports = router;
