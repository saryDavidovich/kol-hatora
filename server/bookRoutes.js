// server/bookRoutes.js
//
// כל הפעולות ברמת "ספר שלם": העלאת קובץ מסכת (parseMasechetFile),
// סריקת ראשי תיבות בכל הספר או בדף בודד (findAbbreviations), הגהה
// ואישור שלהם, ולבסוף בנייה + העלאה מרוכזת לכל הדפים בבת אחת.
//
// מטופל בקובץ נפרד מ-adminRoutes.js כדי לא להפוך אותו לענק.

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const bookBatch = require('./bookBatch');
const jobs = require('./jobs');
const settings = require('./settings');
const { parseMasechetFile } = require('../pipeline/parseMasechetFile');
const { findAbbreviations } = require('../pipeline/findAbbreviations');
const { scrapeAmudAll, splitBoldSegments } = require('../pipeline/scrapeWikitext');
const { buildTrackAudio } = require('../pipeline/buildAudio');
const { uploadAmud } = require('../pipeline/uploadToYemot');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

router.use(express.json({ limit: '2mb' }));

// --- 1. העלאת קובץ מסכת שלם - מפרק ושומר את הגמרא לכל עמוד ---
router.post('/:masechet/upload-file', upload.single('file'), async (req, res) => {
  const { masechet } = req.params;
  if (!req.file) return res.status(400).json({ error: 'לא צורף קובץ' });

  try {
    const content = req.file.buffer.toString('utf-8');
    const { masechetName, amudim } = parseMasechetFile(content);

    for (const a of amudim) {
      await bookBatch.setAmudGemara(masechet, a.daf, a.amud, a.plainText);
    }

    res.json({ masechetName, amudimCount: amudim.length });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- 2. מצב הספר (אילו דפים נטענו, סטטוסים) ---
router.get('/:masechet/state', async (req, res) => {
  const state = await bookBatch.getBookState(req.params.masechet);
  res.json(state);
});

// --- 3. סריקת ראשי תיבות ---
// scope='book': סורק את כל הגמרא שנטענה מהקובץ לכל הספר
// scope='daf': סורק טקסטים נתונים (מכל עמודה בעורך דף בודד) - עובד
//              על כל מסכת, לא רק כאלה שהועלה להן קובץ
router.post('/:masechet/scan-abbreviations', async (req, res) => {
  const { masechet } = req.params;
  const { scope, daf, amud, texts } = req.body;

  try {
    if (scope === 'book') {
      const state = await bookBatch.getBookState(masechet);
      const allOccurrences = [];
      for (const key of Object.keys(state.amudim)) {
        const a = state.amudim[key];
        const found = findAbbreviations(a.gemara || '');
        found.forEach((f) => allOccurrences.push({ ...f, daf: a.daf, amud: a.amud, track: 'gemara' }));
      }
      const saved = await bookBatch.setAbbreviations(masechet, 'book', allOccurrences);
      return res.json({ count: saved.length });
    }

    if (scope === 'daf') {
      const scopeKey = `daf:${daf}${amud}`;
      const allOccurrences = [];
      for (const track of ['gemara', 'rashi', 'tosafot']) {
        if (!texts || !texts[track]) continue;
        const found = findAbbreviations(texts[track]);
        found.forEach((f) => allOccurrences.push({ ...f, daf: Number(daf), amud, track }));
      }
      const saved = await bookBatch.setAbbreviations(masechet, scopeKey, allOccurrences);
      return res.json({ count: saved.length });
    }

    res.status(400).json({ error: 'scope לא תקין (צריך "book" או "daf")' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 4. רשימת ראשי התיבות לצורך הגהה ---
router.get('/:masechet/abbreviations', async (req, res) => {
  const { scope } = req.query;
  const list = await bookBatch.getAbbreviations(req.params.masechet, scope);
  res.json({ abbreviations: list });
});

// --- 5. אישור/עריכת ראש תיבה בודד ---
router.post('/:masechet/abbreviations/:id/approve', async (req, res) => {
  const { expansion } = req.body;
  try {
    const item = await bookBatch.approveAbbreviation(req.params.masechet, req.params.id, expansion);
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- 6. החלת ההגהות המאושרות בחזרה על הטקסט ---
router.post('/:masechet/apply-abbreviations', async (req, res) => {
  const { masechet } = req.params;
  const { scope, texts } = req.body; // texts נדרש רק עבור scope='daf'

  try {
    const items = (await bookBatch.getAbbreviations(masechet, scope)).filter((a) => a.status === 'approved');

    if (scope === 'book') {
      const state = await bookBatch.getBookState(masechet);
      // ממיינים לפי מיקום יורד כדי שההחלפות לא יזיזו אינדקסים של החלפות קודמות
      const byAmud = {};
      items.forEach((it) => {
        const key = `${it.daf}${it.amud}`;
        (byAmud[key] = byAmud[key] || []).push(it);
      });
      for (const key of Object.keys(byAmud)) {
        if (!state.amudim[key]) continue;
        let text = state.amudim[key].gemara;
        const sorted = byAmud[key].sort((a, b) => b.charIndex - a.charIndex);
        for (const it of sorted) {
          text = text.slice(0, it.charIndex) + it.expansion + text.slice(it.charEndIndex);
        }
        state.amudim[key].gemara = text;
      }
      await bookBatch.saveBookState(masechet, state);
      return res.json({ ok: true, appliedCount: items.length });
    }

    if (scope && scope.startsWith('daf:')) {
      // עבור דף בודד - הטקסטים מגיעים מהעורך (לא מהאחסון), מחזירים אותם מתוקנים
      const result = { ...texts };
      for (const track of ['gemara', 'rashi', 'tosafot']) {
        if (!result[track]) continue;
        const trackItems = items.filter((it) => it.track === track).sort((a, b) => b.charIndex - a.charIndex);
        let text = result[track];
        for (const it of trackItems) {
          text = text.slice(0, it.charIndex) + it.expansion + text.slice(it.charEndIndex);
        }
        result[track] = text;
      }
      return res.json({ ok: true, texts: result, appliedCount: items.length });
    }

    res.status(400).json({ error: 'scope לא תקין' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 7. בנייה מרוכזת לכל הספר (TTS לכל הדפים שנטענו) ---
router.post('/:masechet/build-all', async (req, res) => {
  const { masechet } = req.params;

  const jobId = jobs.runAsJob(async (progress) => {
    const state = await bookBatch.getBookState(masechet);
    const { voiceNormal, voiceBold } = await settings.getVoices();
    if (!voiceNormal) throw new Error('לא נבחר קול ברירת מחדל - עברו ל-⚙️ הגדרות קול קודם');

    const keys = Object.keys(state.amudim);
    let done = 0;

    for (const key of keys) {
      const a = state.amudim[key];
      progress(Math.round((done / keys.length) * 100), `בונה ${masechet} ${a.daf}${a.amud} (${done + 1}/${keys.length})...`);

      const dafPadded = String(a.daf).padStart(3, '0');
      const outDir = path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, a.amud);
      await fs.ensureDir(outDir);

      // גמרא - מהקובץ שהועלה (עם הגהות ראשי-תיבות מאושרות שכבר הוחלו)
      const gemaraSegments = splitBoldSegments(a.gemara);
      const builtTracks = [];
      if (gemaraSegments.length) {
        await buildTrackAudio({
          segments: gemaraSegments, voiceNormal, voiceBold, useBeeps: true, outDir, trackName: 'gemara',
        });
        builtTracks.push('gemara');
      }

      // רש"י/תוספות - כרגיל, מוויקיטקסט
      try {
        const { tracks } = await scrapeAmudAll(masechet, a.daf, a.amud);
        for (const trackName of ['rashi', 'tosafot']) {
          const data = tracks[trackName];
          if (!data.missing && data.segments.length) {
            await buildTrackAudio({
              segments: data.segments, voiceNormal, voiceBold, useBeeps: true, outDir, trackName,
            });
            builtTracks.push(trackName);
          }
        }
      } catch (err) {
        console.warn(`  רש"י/תוספות נכשלו עבור ${masechet} ${a.daf}${a.amud}: ${err.message}`);
      }

      await fs.writeJson(path.join(outDir, 'meta.json'), {
        masechet, daf: a.daf, amud: a.amud, tracks: builtTracks, generatedAt: new Date().toISOString(),
      }, { spaces: 2 });

      done++;
    }

    progress(100, `הושלם - נבנו ${done} עמודים`);
    return { builtCount: done };
  });

  res.json({ jobId });
});

// --- 8. העלאה מרוכזת לימות לכל הדפים שנבנו ---
router.post('/:masechet/upload-all', async (req, res) => {
  const { masechet } = req.params;

  const jobId = jobs.runAsJob(async (progress) => {
    const state = await bookBatch.getBookState(masechet);
    const keys = Object.keys(state.amudim);
    let done = 0;

    const templatePath = path.join(__dirname, '..', 'config', 'ext-playfile-daf-template.ini');
    const apiPlayerUrl = process.env.API_PLAYER_URL || 'https://YOUR-SERVER-DOMAIN.example.com/api/player/control';
    const extIniContent = (await fs.readFile(templatePath, 'utf-8'))
      .replace('https://YOUR-SERVER-DOMAIN.example.com/api/player/control', apiPlayerUrl);

    for (const key of keys) {
      const a = state.amudim[key];
      const dafPadded = String(a.daf).padStart(3, '0');
      const localDir = path.join(CONTENT_ROOT, 'shas', masechet, `daf-${dafPadded}`, a.amud);

      if (!(await fs.pathExists(localDir))) {
        console.warn(`  מדלג - ${masechet} ${a.daf}${a.amud} לא נבנה עדיין`);
        done++;
        continue;
      }

      progress(Math.round((done / keys.length) * 100), `מעלה ${masechet} ${a.daf}${a.amud} (${done + 1}/${keys.length})...`);
      const remoteFolder = `/20/${masechet}/${dafPadded}/${a.amud}`;
      await uploadAmud({ localDir, remoteFolder, extIniContent });
      done++;
    }

    progress(100, `הושלם - הועלו ${done} עמודים`);
    return { uploadedCount: done };
  });

  res.json({ jobId });
});

module.exports = router;
