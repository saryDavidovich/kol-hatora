// server/adminRoutes.js
//
// כל ה-endpoints שממשק הניהול (public/admin) קורא להם.
// זרימת עבודה טיפוסית של מנהל:
//   1. GET  /admin/api/overview                        - דשבורד: כל המסכתות + התקדמות
//   2. GET  /admin/api/masechet/:m                      - כל הדפים במסכת + סטטוס כל אחד
//   3. GET  /admin/api/daf/:m/:daf/:amud                - טוען עמוד (טיוטה אם יש, אחרת חי מוויקיטקסט)
//   4. POST /admin/api/nikud                            - מנקד קטע טקסט (לא שומר - רק מחזיר)
//   5. POST /admin/api/daf/:m/:daf/:amud/save           - שומר טיוטה ערוכה
//   6. POST /admin/api/daf/:m/:daf/:amud/refetch/:track - מושך מחדש מוויקיטקסט (מתעלם מטיוטה)
//   7. POST /admin/api/daf/:m/:daf/:amud/build          - בונה TTS+אודיו (job אסינכרוני)
//   8. GET  /admin/api/jobs/:id                          - סטטוס משימת רקע
//   9. GET  /admin/api/daf/:m/:daf/:amud/audio/:track    - האזנה לתוצאה שנבנתה
//  10. POST /admin/api/daf/:m/:daf/:amud/upload          - מעלה לימות (job אסינכרוני)

const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const router = express.Router();

const drafts = require('./drafts');
const contentIndex = require('./contentIndex');
const jobs = require('./jobs');
const { scrapeTrack, splitBoldSegments } = require('../pipeline/scrapeWikitext');
const { addNikud } = require('../pipeline/nikud');
const { buildTrackAudio } = require('../pipeline/buildAudio');
const { uploadAmud } = require('../pipeline/uploadToYemot');
const MASECHTOT_DAPIM = require('../pipeline/masechtotDapim');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
const VOICE_NORMAL = process.env.TTS_VOICE_NORMAL || 'he-IL-male-1';
const VOICE_BOLD = process.env.TTS_VOICE_BOLD || 'he-IL-male-2';

router.use(express.json({ limit: '2mb' }));

// --- 1. דשבורד ---
router.get('/overview', async (req, res) => {
  const result = [];
  for (const [masechet, maxDaf] of Object.entries(MASECHTOT_DAPIM)) {
    let builtCount = 0;
    for (let daf = 2; daf <= maxDaf; daf++) {
      for (const amud of ['a', 'b']) {
        if (contentIndex.amudExists(masechet, daf, amud)) builtCount++;
      }
    }
    const totalAmudim = (maxDaf - 1) * 2;
    result.push({ masechet, totalAmudim, builtCount });
  }
  res.json({ masechtot: result });
});

// --- 2. כל הדפים במסכת + סטטוס ---
router.get('/masechet/:masechet', async (req, res) => {
  const { masechet } = req.params;
  const maxDaf = MASECHTOT_DAPIM[masechet];
  if (!maxDaf) return res.status(404).json({ error: `מסכת "${masechet}" לא מוכרת` });

  const dapim = [];
  for (let daf = 2; daf <= maxDaf; daf++) {
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

// --- 3. טעינת עמוד לעריכה ---
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

  const tracks = {};
  for (const track of ['gemara', 'rashi', 'tosafot']) {
    try {
      const { plainText } = await scrapeTrack(masechet, daf, amud, track);
      tracks[track] = plainText;
    } catch (err) {
      tracks[track] = '';
      tracks[`${track}_error`] = err.message;
    }
  }
  res.json({ source: 'wikitext', ...tracks });
});

// --- 4. ניקוד (לא שומר) ---
router.post('/nikud', async (req, res) => {
  const { text, genre } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const nikudText = await addNikud(text, genre || 'rabbinic');
    res.json({ text: nikudText });
  } catch (err) {
    res.status(502).json({ error: `שירות הניקוד נכשל: ${err.message}` });
  }
});

// --- 5. שמירת טיוטה ---
router.post('/daf/:masechet/:daf/:amud/save', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);
  const { gemara, rashi, tosafot } = req.body;

  const saved = await drafts.saveDraft(masechet, daf, amud, { gemara, rashi, tosafot });
  res.json({ ok: true, updatedAt: saved.updatedAt });
});

// --- 6. משיכה מחדש מוויקיטקסט (טראק בודד) ---
router.post('/daf/:masechet/:daf/:amud/refetch/:track', async (req, res) => {
  const { masechet, amud, track } = req.params;
  const daf = parseInt(req.params.daf, 10);
  try {
    const { plainText } = await scrapeTrack(masechet, daf, amud, track);
    res.json({ text: plainText });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- 7. בניית TTS + אודיו (אסינכרוני) ---
router.post('/daf/:masechet/:daf/:amud/build', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);
  const { gemara, rashi, tosafot } = req.body;

  const dafPadded = String(daf).padStart(3, '0');
  const outDir = path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, amud);

  const jobId = jobs.runAsJob(async (progress) => {
    const tracksToBuild = [
      ['gemara', gemara], ['rashi', rashi], ['tosafot', tosafot],
    ].filter(([, text]) => text && text.trim());

    let done = 0;
    for (const [trackName, text] of tracksToBuild) {
      progress(Math.round((done / tracksToBuild.length) * 90), `בונה אודיו: ${trackName}...`);

      // התחביר '''טקסט מודגש''' (כמו בוויקיטקסט) נתמך גם כאן - אם המנהל
      // כתב/השאיר קטעים בתחביר הזה בעריכה, הם יושמעו בקול/צליל שונה.
      const segments = splitBoldSegments(text);
      const finalSegments = segments.length ? segments : [{ text, bold: false }];

      await buildTrackAudio({
        segments: finalSegments, voiceNormal: VOICE_NORMAL, voiceBold: VOICE_BOLD, useBeeps: true,
        outDir, trackName,
      });
      done++;
    }

    await fs.writeJson(path.join(outDir, 'meta.json'), {
      masechet, daf, amud, generatedAt: new Date().toISOString(), tracks: tracksToBuild.map((t) => t[0]),
    }, { spaces: 2 });

    progress(100, 'הושלם');
    return { outDir };
  });

  res.json({ jobId });
});

// --- 8. סטטוס job ---
router.get('/jobs/:id', (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job לא נמצא (או פג תוקף)' });
  res.json(job);
});

// --- 9. האזנה לתוצאה ---
router.get('/daf/:masechet/:daf/:amud/audio/:track', async (req, res) => {
  const { masechet, amud, track } = req.params;
  const daf = parseInt(req.params.daf, 10);
  const filePath = contentIndex.trackFile(masechet, daf, amud, track);
  if (!(await fs.pathExists(filePath))) {
    return res.status(404).json({ error: 'הקובץ עדיין לא נבנה' });
  }
  res.type('audio/wav');
  fs.createReadStream(filePath).pipe(res);
});

// --- 10. העלאה לימות (אסינכרוני) ---
router.post('/daf/:masechet/:daf/:amud/upload', async (req, res) => {
  const { masechet, amud } = req.params;
  const daf = parseInt(req.params.daf, 10);
  const dafPadded = String(daf).padStart(3, '0');
  const localDir = path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, amud);

  if (!(await fs.pathExists(localDir))) {
    return res.status(400).json({ error: 'יש לבנות את העמוד (שלב 7) לפני העלאה' });
  }

  const jobId = jobs.runAsJob(async (progress) => {
    progress(10, 'מתחבר לימות...');
    const templatePath = path.join(__dirname, '..', 'config', 'ext-playfile-daf-template.ini');
    const apiPlayerUrl = process.env.API_PLAYER_URL || 'https://YOUR-SERVER-DOMAIN.example.com/api/player/control';
    const extIniContent = (await fs.readFile(templatePath, 'utf-8'))
      .replace('https://YOUR-SERVER-DOMAIN.example.com/api/player/control', apiPlayerUrl);

    const remoteFolder = `/20/${masechet}/${dafPadded}/${amud}`;
    progress(30, `מעלה קבצים ל-${remoteFolder}...`);
    await uploadAmud({ localDir, remoteFolder, extIniContent });
    progress(100, 'הועלה בהצלחה');
    return { remoteFolder };
  });

  res.json({ jobId });
});

module.exports = router;
