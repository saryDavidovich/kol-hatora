// server/promptsRoutes.js
// הפקת הודעות קוליות (הודעות מערכת) לקווי ימות - מסך "הפקת הודעות" בממשק הניהול.
// מדביקים רשימה "מספר | טקסט", בוחרים קול, ומקבלים ZIP עם NNN/000.wav לכל הודעה,
// בפורמט שימות מקבלת (WAV, PCM 16 ביט, 8000Hz, מונו) - מוכן להעלאה לתיקייה
// "הודעות מערכת" בקו. הטקסט נשלח לקריין בדיוק כפי שהוקלד (כולל ניקוד), בלי שינוי.
// שורה שהטקסט שלה הוא [צליל] מקבלת צפצוף קצר במקום הקראה.
require('dotenv').config();
const express = require('express');
const axios = require('axios');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));

const GOOGLE_TTS_URL = process.env.GOOGLE_TTS_URL || 'https://texttospeech.googleapis.com/v1/text:synthesize';
const MAX_ITEMS = 300;
const MAX_TEXT = 3000;
const BEEP_TOKEN = '[צליל]';

// ---------------------------------------------------------------------------
// קריין: Google TTS, LINEAR16 ב-8000Hz (Google מחזיר קובץ WAV שלם עם כותרת)
// ---------------------------------------------------------------------------
async function synthesizeWav(text, voice, rate) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('לא הוגדר GOOGLE_TTS_API_KEY');
  try {
    const resp = await axios.post(`${GOOGLE_TTS_URL}?key=${key}`, {
      input: { text },
      voice: { languageCode: 'he-IL', name: voice },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 8000, speakingRate: rate },
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
    return Buffer.from(resp.data.audioContent, 'base64');
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.error
      ? err.response.data.error.message : err.message;
    throw new Error(`הקראה נכשלה: ${detail}`);
  }
}

// צפצוף קצר (0.15 שנייה, 900Hz) כ-WAV של 8000Hz - בלי צורך ב-ffmpeg
function beepWav() {
  const rate = 8000, secs = 0.15, n = Math.round(rate * secs);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 80, (n - i) / 80);   // בלי "קליק" בהתחלה ובסוף
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 900 * i / rate) * 9000 * fade), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// ---------------------------------------------------------------------------
// ZIP פשוט (שמירה בלי דחיסה - WAV כמעט לא מתכווץ), עם שמות UTF-8
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files) {   // files: [{name, data}]
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

// ---------------------------------------------------------------------------
function cleanItems(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('הרשימה ריקה');
  if (raw.length > MAX_ITEMS) throw new Error(`עד ${MAX_ITEMS} הודעות בפעם אחת`);
  const seen = new Set();
  return raw.map((it, idx) => {
    const num = String(it.num || '').trim();
    const text = String(it.text || '').trim();
    if (!/^\d{1,3}$/.test(num)) throw new Error(`שורה ${idx + 1}: מספר הודעה לא תקין ("${num}")`);
    if (!text) throw new Error(`שורה ${idx + 1}: חסר טקסט`);
    if (text.length > MAX_TEXT) throw new Error(`שורה ${idx + 1}: הטקסט ארוך מדי`);
    const padded = num.padStart(3, '0');
    if (seen.has(padded)) throw new Error(`המספר ${padded} מופיע פעמיים`);
    seen.add(padded);
    return { num: padded, text };
  });
}
function cleanRate(r) {
  const v = Number(r);
  return Number.isFinite(v) && v >= 0.5 && v <= 1.5 ? v : 1.0;
}
function audioFor(text, voice, rate) {
  return text === BEEP_TOKEN ? Promise.resolve(beepWav()) : synthesizeWav(text, voice, rate);
}

// --- שמיעה של הודעה אחת לפני ההפקה ---
router.post('/preview', async (req, res) => {
  try {
    const [item] = cleanItems([{ num: '1', text: req.body.text }]);
    if (!req.body.voice && item.text !== BEEP_TOKEN) return res.status(400).json({ error: 'לא נבחר קול' });
    const wav = await audioFor(item.text, req.body.voice, cleanRate(req.body.rate));
    res.json({ audioBase64: wav.toString('base64') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- הפקת כל ההודעות כ-ZIP: NNN/000.wav ---
router.post('/zip', async (req, res) => {
  let items;
  try {
    items = cleanItems(req.body.items);
    if (!req.body.voice) throw new Error('לא נבחר קול');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const rate = cleanRate(req.body.rate);
  const files = new Array(items.length);
  try {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        try {
          files[i] = { name: `${items[i].num}/000.wav`, data: await audioFor(items[i].text, req.body.voice, rate) };
        } catch (err) {
          throw new Error(`הודעה ${items[i].num}: ${err.message}`);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  const zip = buildZip(files);
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="ivr-prompts.zip"; filename*=UTF-8''${encodeURIComponent('הודעות_מערכת.zip')}`,
    'Content-Length': zip.length,
  });
  res.send(zip);
});

module.exports = router;
module.exports._test = { buildZip, beepWav, crc32, cleanItems };
