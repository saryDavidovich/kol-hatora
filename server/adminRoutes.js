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
const { scrapeAmudAll, scrapeTrack, splitBoldSegments, segmentsToMarkedText } = require('../pipeline/scrapeWikitext');
const { addNikud } = require('../pipeline/nikud');
const { addPunctuation } = require('../pipeline/punctuation');
const { buildTrackAudio } = require('../pipeline/buildAudio');
const { listHebrewVoices, synthesizeToFile } = require('../pipeline/ttsProvider');
const settings = require('./settings');
const { uploadAmud } = require('../pipeline/uploadToYemot');
const MASECHTOT_DAPIM = require('../pipeline/masechtotDapim');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
// קולות ברירת המחדל נטענים דינמית מ-server/settings.js (ניתן לבחור
// ולשמור מהממשק - ראה /voices ו-/settings למטה), עם נפילה חינה
// למשתני הסביבה TTS_VOICE_NORMAL/TTS_VOICE_BOLD אם עדיין לא נבחר כלום.

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
  try {
    const { tracks: allTracks } = await scrapeAmudAll(masechet, daf, amud);
    for (const track of ['gemara', 'rashi', 'tosafot']) {
      const data = allTracks[track];
      tracks[track] = segmentsToMarkedText(data.segments);
      if (data.missing) tracks[`${track}_error`] = 'הכותרת לא נמצאה בעמוד הזה בוויקיטקסט';
    }
  } catch (err) {
    // כשל בשליפת העמוד כולו (למשל שם לא נמצא) - מציגים את השגיאה בכל העמודות
    for (const track of ['gemara', 'rashi', 'tosafot']) {
      tracks[track] = '';
      tracks[`${track}_error`] = err.message;
    }
  }
  res.json({ source: 'wikitext', ...tracks });
});

// --- 4. ניקוד בלבד (דיקטה, חינמי) ---
/**
 * מגן על סימוני '''הדגשה''' בזמן שהטקסט עובר דרך שירותים חיצוניים
 * (ניקוד/פיסוק) - אלה לא "יודעים" שהגרשיים המשולשים הם קוד טכני
 * שאסור לגעת בו, ועלולים לפצל/להזיז אותם. זה גורם לעשרות קטעי הדגשה
 * קטנטנים שגויים בזמן הבנייה - שנשמעים כמו "גמגום" (הרבה ביפים
 * וקטעים קטנים לסירוגין). הפתרון: מחליפים לפני השליחה למחרוזת ניטרלית
 * שלא תיפגע, ומחזירים בחזרה אחרי קבלת התוצאה.
 */
const BOLD_MARK_PLACEHOLDER = '\u0001BOLD\u0001'; // תו בלתי-נראה, לא יתנגש עם טקסט אמיתי

function protectBoldMarks(text) {
  return text.split("'''").join(BOLD_MARK_PLACEHOLDER);
}
function restoreBoldMarks(text) {
  return text.split(BOLD_MARK_PLACEHOLDER).join("'''");
}

router.post('/nikud', async (req, res) => {
  const { text, genre } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const nikudText = await addNikud(protectBoldMarks(text), genre || 'rabbinic');
    res.json({ text: restoreBoldMarks(nikudText) });
  } catch (err) {
    res.status(502).json({ error: `שירות הניקוד נכשל: ${err.message}` });
  }
});

// --- 4ב. פיסוק בלבד (Claude API - עולה כסף! נפרד מהניקוד בכוונה,
//     כדי שתפעילו אותו רק כשאתם באמת רוצים, ולא בכל לחיצת ניקוד) ---
router.post('/punctuate', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'חסר טקסט' });
  try {
    const punctuated = await addPunctuation(protectBoldMarks(text));
    res.json({ text: restoreBoldMarks(punctuated) });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
    const { segments } = await scrapeTrack(masechet, daf, amud, track);
    res.json({ text: segmentsToMarkedText(segments) });
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
    const { voiceNormal, voiceBold } = await settings.getVoices();
    if (!voiceNormal) {
      throw new Error('לא נבחר קול ברירת מחדל - עברו ל"⚙️ הגדרות קול" ובחרו קול לפני הבנייה');
    }
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
        segments: finalSegments, voiceNormal, voiceBold, useBeeps: true,
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

// ==================== הגדרות קול (Google Cloud TTS) ====================

// זיכרון מטמון קצר לרשימת הקולות - היא לא משתנה תוך כדי הרצה, ואין
// טעם לפנות לגוגל בכל פעם שנכנסים למסך ההגדרות
let voicesCache = null;
let voicesCacheAt = 0;
const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;

// --- רשימת הקולות העבריים האמיתיים הזמינים בחשבון שלכם ---
router.get('/voices', async (req, res) => {
  try {
    const now = Date.now();
    if (!voicesCache || now - voicesCacheAt > VOICES_CACHE_TTL_MS) {
      voicesCache = await listHebrewVoices();
      voicesCacheAt = now;
    }
    res.json({ voices: voicesCache });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- נגינת משפט לדוגמה בקול נבחר, כדי לשמוע לפני שבוחרים ---
// הערה: התגובה מוחזרת כ-JSON עם base64 (לא כקובץ בינארי ישיר) - חלק
// ממערכות סינון תוכן (כמו נטפרי) מסמנות תגובות בינאריות מבקשות POST
// כ"חשודות" באופן אוטומטי; JSON רגיל נוטה לעורר פחות חשד כזה.
router.post('/voices/preview', async (req, res) => {
  const { voice, text } = req.body;
  if (!voice) return res.status(400).json({ error: 'חסר שם קול' });

  const sampleText = text || 'מאימתי קורין את שמע בערבין, משעה שהכהנים נכנסים לאכול בתרומתן';
  const tmpPath = path.join(require('os').tmpdir(), `preview_${Date.now()}.wav`);

  try {
    await synthesizeToFile(sampleText, voice, tmpPath);
    const audioBuffer = await fs.readFile(tmpPath);
    res.json({ audioBase64: audioBuffer.toString('base64') });
  } catch (err) {
    res.status(502).json({ error: err.message });
  } finally {
    fs.remove(tmpPath).catch(() => {});
  }
});

// --- קריאה/שמירה של הקולות הנבחרים כברירת מחדל לבניית עמודים ---
router.get('/settings', async (req, res) => {
  const voices = await settings.getVoices();
  res.json(voices);
});

router.post('/settings', async (req, res) => {
  const { voiceNormal, voiceBold } = req.body;
  const saved = await settings.updateSettings({ voiceNormal, voiceBold });
  res.json(saved);
});

module.exports = router;
