// server/adminRoutes.js
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

const contentIndex = require('./contentIndex');
const drafts = require('./drafts');
const settings = require('./settings');
const menuTree = require('./menuTree');
const { getApiPlayerUrl } = require('./config');
const jobs = require('./jobs');
const MASECHTOT_DAPIM = require('../pipeline/masechtotDapim');
const { scrapeAmudAll, splitBoldSegments } = require('../pipeline/scrapeWikitext');
const { addNikud } = require('../pipeline/nikud');
const { addPunctuation } = require('../pipeline/punctuation');
const { findAbbreviations } = require('../pipeline/findAbbreviations');
const { buildTrackAudio } = require('../pipeline/buildAudio');
const { uploadAmud, login, updateExtensionTitle } = require('../pipeline/uploadToYemot');
const { listHebrewVoices, synthesizeSample } = require('../pipeline/ttsProvider');

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
// תמחור גוגל TTS (דולר ל-מיליון תווים) - מזוהה לפי הדפוס בשם הקול.
// מבוסס על טבלת התמחור הפומבית של גוגל (עודכן 2026).
const TIER_PRICING = [
  { pattern: /Studio/i, labelHe: 'סטודיו (פרימיום)', pricePerMillion: 160 },
  { pattern: /Chirp3.*HD|Chirp-HD/i, labelHe: 'Chirp3 HD (חדש, טבעי מאוד)', pricePerMillion: 30 },
  { pattern: /Neural2/i, labelHe: 'נוירל2', pricePerMillion: 16 },
  { pattern: /Polyglot/i, labelHe: 'פוליגלוט', pricePerMillion: 16 },
  { pattern: /Wavenet/i, labelHe: 'WaveNet (טבעי)', pricePerMillion: 4 },
  { pattern: /Standard/i, labelHe: 'רגיל', pricePerMillion: 4 },
];

function classifyVoice(voice) {
  const tier = TIER_PRICING.find((t) => t.pattern.test(voice.name)) || { labelHe: 'לא ידוע', pricePerMillion: null };
  const genderHe = voice.ssmlGender === 'MALE' ? 'גברי' : voice.ssmlGender === 'FEMALE' ? 'נשי' : 'לא ידוע';
  return {
    ...voice,
    tierLabel: tier.labelHe,
    pricePerMillionChars: tier.pricePerMillion,
    genderHe,
  };
}

router.get('/voices', async (req, res) => {
  try {
    const voices = await listHebrewVoices();
    const enriched = voices.map(classifyVoice).sort((a, b) => (a.pricePerMillionChars || 0) - (b.pricePerMillionChars || 0));
    const current = await settings.getVoices();
    res.json({ voices: enriched, current });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- דוגמת שמע קצרה לקול נבחר (base64, מוטמע ישירות בתגובה - אין צורך בשמירה לדיסק) ---
router.post('/voices/sample', async (req, res) => {
  const { voiceName } = req.body;
  if (!voiceName) return res.status(400).json({ error: 'חסר שם קול' });
  try {
    const sampleText = 'מאימתי קורין את שמע בערבין, משעה שהכהנים נכנסים לאכול בתרומתן';
    const audioBase64 = await synthesizeSample(sampleText, voiceName);
    res.json({ audioBase64 });
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
    if (!process.env.API_PLAYER_URL) {
      throw new Error('משתנה הסביבה API_PLAYER_URL לא מוגדר ב-Railway - תפריט המפרשים ומעבר דפים לא יעבדו. הגדירו אותו קודם (ראו לוגי השרת להוראות).');
    }
    const apiPlayerUrl = getApiPlayerUrl();
    const amudHeb = amud === 'a' ? 'א' : 'ב';
    // title= - "כינוי השלוחה" האמיתי, מתועד רשמית (UpdateExtension עם
    // title=), שגורם לימות להציג שם קריא. כל רמה מקבלת רק את השם שלה
    // (לא נתיב מלא) - עקבי עם שאר רמות הביניים שמתויגות למטה.
    const readableTitle = `title=עמוד ${amudHeb}\n`;
    const extIniContent = readableTitle + (await fs.readFile(templatePath, 'utf-8'))
      .replace(/https:\/\/YOUR-SERVER-DOMAIN\.example\.com\/api\/player\/control/g, apiPlayerUrl);

    progress(30, 'מתחבר לימות...');
    const remoteFolder = await menuTree.getMasechetYemotFolder(masechet, daf, amud);
    progress(50, `מעלה ל-${remoteFolder}...`);
    await uploadAmud({ localDir, remoteFolder, extIniContent });

    // מתייגים גם את כל תיקיות הביניים (סדרים/מסכת/דף) בנפרד - בלי
    // לדרוס את ה-ext.ini שלהן (UpdateExtension מעדכן רק את ה-title,
    // לא כל שאר ההגדרות - ראו pipeline/uploadToYemot.js)
    progress(70, 'מתייג תיקיות ביניים...');
    const token = await login();
    const tree = await menuTree.getTree();
    const treeLevels = menuTree.getYemotPathLevelsWithNames(tree, masechet);
    for (const level of treeLevels) {
      await updateExtensionTitle(token, `/${level.pathPrefix.join('/')}`, level.name);
    }
    const dafPadded = String(daf).padStart(3, '0');
    const masechetPrefix = treeLevels[treeLevels.length - 1].pathPrefix;
    await updateExtensionTitle(token, `/${[...masechetPrefix, dafPadded].join('/')}`, `דף ${daf}`);

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
