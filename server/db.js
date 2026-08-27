// server/db.js
// שכבת גישה למסד הנתונים (SQLite) - שומרת עבור כל מאזין (לפי מספר טלפון)
// את המיקום האחרון בכל "ערוץ" (גמרא / רש"י / תוספות) בכל עמוד גמרא בנפרד.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'state.db');
fs.ensureDirSync(path.dirname(DB_FILE));

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS positions (
  phone       TEXT NOT NULL,
  masechet    TEXT NOT NULL,
  daf         INTEGER NOT NULL,
  amud        TEXT NOT NULL,          -- 'a' או 'b' (עמוד א/ב)
  track       TEXT NOT NULL,          -- 'gemara' | 'rashi' | 'tosafot'
  offset_ms   INTEGER NOT NULL DEFAULT 0,   -- מיקום בזמן המקורי של ההקלטה (לא מושפע ממהירות)
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (phone, masechet, daf, amud, track)
);

CREATE TABLE IF NOT EXISTS call_state (
  phone       TEXT PRIMARY KEY,
  masechet    TEXT,
  daf         INTEGER,
  amud        TEXT,
  track       TEXT NOT NULL DEFAULT 'gemara',
  speed       REAL NOT NULL DEFAULT 1.0,   -- 0.7 עד 1.6 לדוגמה
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** שמירת מיקום עצירה עבור מאזין+עמוד+ערוץ מסוים */
function savePosition(phone, masechet, daf, amud, track, offsetMs) {
  db.prepare(`
    INSERT INTO positions (phone, masechet, daf, amud, track, offset_ms, updated_at)
    VALUES (@phone, @masechet, @daf, @amud, @track, @offsetMs, datetime('now'))
    ON CONFLICT(phone, masechet, daf, amud, track)
    DO UPDATE SET offset_ms = @offsetMs, updated_at = datetime('now')
  `).run({ phone, masechet, daf, amud, track, offsetMs });
}

/** שליפת מיקום עצירה - מחזיר 0 אם אין רשומה (כלומר יתחיל מההתחלה) */
function getPosition(phone, masechet, daf, amud, track) {
  const row = db.prepare(`
    SELECT offset_ms FROM positions
    WHERE phone=? AND masechet=? AND daf=? AND amud=? AND track=?
  `).get(phone, masechet, daf, amud, track);
  return row ? row.offset_ms : 0;
}

/** שמירת "איפה נמצא המאזין עכשיו" (עבור תפריטי ניווט - דף הבא/קודם, חזרה) */
function setCallState(phone, patch) {
  const current = getCallState(phone) || {
    phone, masechet: null, daf: null, amud: null, track: 'gemara', speed: 1.0
  };
  const merged = { ...current, ...patch, phone };
  db.prepare(`
    INSERT INTO call_state (phone, masechet, daf, amud, track, speed, updated_at)
    VALUES (@phone, @masechet, @daf, @amud, @track, @speed, datetime('now'))
    ON CONFLICT(phone) DO UPDATE SET
      masechet=@masechet, daf=@daf, amud=@amud, track=@track, speed=@speed, updated_at=datetime('now')
  `).run(merged);
  return merged;
}

function getCallState(phone) {
  return db.prepare(`SELECT * FROM call_state WHERE phone=?`).get(phone) || null;
}

module.exports = { savePosition, getPosition, setCallState, getCallState, _raw: db };
