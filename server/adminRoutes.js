// server/adminRoutes.js
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

const contentIndex = require('./contentIndex');
const drafts = require('./drafts');
const settings = require('./settings');
const menuTree = require('./menuTree');
const jobs = require('./jobs');
const MASECHTOT_DAPIM = require('../pipeline/masechtotDapim');
const { scrapeAmudAll, splitBoldSegments } = require('../pipeline/scrapeWikitext');
const { addNikud } = require('../pipeline/nikud');
const { addPunctuation } = require('../pipeline/punctuation');
const { findAbbreviations } = require('../pipeline/findAbbreviations');
const { buildTrackAudio } = require('../pipeline/buildAudio');
const { uploadAmud } = require('../pipeline/uploadToYemot');
const { listHebrewVoices } = require('../pipeline/ttsProvider');

router.use(express.json({ limit: '2mb' }));

const BOLD_MARK_PLACEHOLDER = '\u0001BOLD\u0001';
const protectBold = (t) => t.split("'''").join(BOLD_MARK_PLACEHOLDER);
const restoreBold = (t) => t.split(BOLD_MARK_PLACEHOLDER).join("'''");

// --- רשימת המסכתות הזמינות (לפי הטבלה) ---
router.get('/masechtot-list', (req, res) => {
  res.json({ masechtot: Object.keys(MASECHTOT_DAPIM) });
});

// --- רשימת דפים למסכת ---
router.get('/masechet/:masechet', async (req, res) => {
  const { masechet } = req.params;
  const range = MASECHTOT_DAPIM[masechet];
  if (!range) return res.status(404).json({ error: `מסכת "${masechet}" לא מוכרת` });

  const dapim = [];
  for (let daf = range.start; daf <= range.end; daf++) {
    for (const amud of ['a', 'b']) {
      const draft = await drafts.getDraft(masechet, daf, amud);
      const built = contentIndex.amudExists(masechet, daf, amud);
      let status = 'לא התחיל';
      if (built) status = 'נבנה';
      else if (draft) status = 'טיוטה';
      dapim.push({ daf, amud, status });
    }
  }
  res.json({ masechet, dapim });
});

// --- טעינת עמוד לעריכה ---
router.get('/daf/:masechet/:daf/:amud', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);

  const draft = await drafts.getDraft(masechet, daf, amud);
  if (draft) {
    return res.json({
      source: 'draft', updatedAt: draft.updatedAt,
      gemara: draft.gemara || '', rashi: draft.rashi || '', tosafot: draft.tosafot || '',
    });
  }

  try {
    const { tracks } = await scrapeAmudAll(masechet, daf, amud);
    res.json({
      source: 'live',
      gemara: tracks.gemara.plainText, gemara_error: null,
      rashi: tracks.rashi.missing ? '' : tracks.rashi.plainText, rashi_error: null,
      tosafot: tracks.tosafot.missing ? '' : tracks.tosafot.plainText, tosafot_error: null,
    });
  } catch (err) {
    res.json({ source: 'live', gemara: '', rashi: '', tosafot: '', gemara_error: err.message });
  }
});

// --- משיכה מחדש של רצועה בודדת מוויקיטקסט ---
router.post('/daf/:masechet/:daf/:amud/refetch/:track', async (req, res) => {
  const { masechet, amud, track } = req.params;
  const daf = parseInt(req.params.daf, 10);
  try {
    const { tracks } = await scrapeAmudAll(masechet, daf, amud);
    const t = tracks[track];
    if (!t || t.missing) return res.json({ text: '' });
    res.json({ text: t.plainText });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- שמירת טיוטה ---
router.post('/daf/:masechet/:daf/:amud/save', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);
  const { gemara, rashi, tosafot } = req.body;
  await drafts.saveDraft(masechet, daf, amud, { gemara, rashi, tosafot });
  res.json({ ok: true });
});

// --- ניקוד ---
router.post('/nikud', async (req, res) => {
  const { text, genre } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const result = await addNikud(protectBold(text), genre || 'rabbinic');
    res.json({ text: restoreBold(result) });
  } catch (err) {
    res.status(502).json({ error: `שירות הניקוד נכשל: ${err.message}` });
  }
});

// --- פיסוק ---
router.post('/punctuate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const result = await addPunctuation(protectBold(text));
    res.json({ text: restoreBold(result) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- בדיקת ראשי תיבות (לעמוד בודד - שלוש הרצועות) ---
router.post('/daf/:masechet/:daf/:amud/check-abbreviations', async (req, res) => {
  const { gemara, rashi, tosafot } = req.body;
  res.json({
    gemara: findAbbreviations(gemara || ''),
    rashi: findAbbreviations(rashi || ''),
    tosafot: findAbbreviations(tosafot || ''),
  });
});

// --- רשימת קולות עברית זמינים ---
router.get('/voices', async (req, res) => {
  try {
    const voices = await listHebrewVoices();
    const current = await settings.getVoices();
    res.json({ voices, current });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/voices', async (req, res) => {
  const { voiceNormal, voiceBold } = req.body;
  await settings.saveSettings({ voiceNormal, voiceBold });
  res.json({ ok: true });
});

// --- בנייה (TTS) לעמוד ---
router.post('/daf/:masechet/:daf/:amud/build', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);
  const { gemara, rashi, tosafot } = req.body;

  const jobId = jobs.runAsJob(async (progress) => {
    const { voiceNormal, voiceBold } = await settings.getVoices();
    if (!voiceNormal) throw new Error('לא נבחר קול ברירת מחדל - עברו ל-⚙️ הגדרות קול קודם');

    const outDir = contentIndex.amudDir(masechet, daf, amud);
    const tracksToBuild = [
      { name: 'gemara', text: gemara },
      { name: 'rashi', text: rashi },
      { name: 'tosafot', text: tosafot },
    ].filter((t) => t.text && t.text.trim());

    let done = 0;
    for (const t of tracksToBuild) {
      progress(Math.round((done / tracksToBuild.length) * 100), `בונה ${t.name}...`);
      const segments = splitBoldSegments(t.text);
      await buildTrackAudio({ segments, voiceNormal, voiceBold, useBeeps: true, outDir, trackName: t.name });
      done++;
    }
    progress(100, 'הושלם');
    return { builtTracks: tracksToBuild.map((t) => t.name) };
  });

  res.json({ jobId });
});

// --- העלאה לימות ---
router.post('/daf/:masechet/:daf/:amud/upload', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);

  const jobId = jobs.runAsJob(async (progress) => {
    const localDir = contentIndex.amudDir(masechet, daf, amud);
    if (!(await fs.pathExists(localDir))) throw new Error('יש לבנות את התוכן קודם');

    const templatePath = path.join(__dirname, '..', 'config', 'ext-playfile-daf-template.ini');
    const apiPlayerUrl = process.env.API_PLAYER_URL || 'https://YOUR-SERVER-DOMAIN.example.com/api/player/control';
    const extIniContent = (await fs.readFile(templatePath, 'utf-8'))
      .replace(/https:\/\/YOUR-SERVER-DOMAIN\.example\.com\/api\/player\/control/g, apiPlayerUrl);

    progress(30, 'מתחבר לימות...');
    const remoteFolder = await menuTree.getMasechetYemotFolder(masechet, daf, amud);
    progress(50, `מעלה ל-${remoteFolder}...`);
    await uploadAmud({ localDir, remoteFolder, extIniContent });
    progress(100, 'הועלה בהצלחה');
    return { remoteFolder };
  });

  res.json({ jobId });
});

// --- מעקב אחר job ---
router.get('/jobs/:id', (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job לא נמצא' });
  res.json(job);
});

module.exports = router;
