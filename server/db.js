// server/db.js
const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'state.db');
fs.ensureDirSync(path.dirname(DB_FILE));

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS call_state (
  phone       TEXT PRIMARY KEY,
  masechet    TEXT,
  daf         INTEGER,
  amud        TEXT,
  track       TEXT NOT NULL DEFAULT 'gemara',
  speed       REAL NOT NULL DEFAULT 1.0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  phone       TEXT NOT NULL,
  masechet    TEXT NOT NULL,
  daf         INTEGER NOT NULL,
  amud        TEXT NOT NULL,
  track       TEXT NOT NULL,
  offset_ms   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (phone, masechet, daf, amud, track)
);
`);

function setCallState(phone, fields) {
  const current = db.prepare('SELECT * FROM call_state WHERE phone = ?').get(phone) || {};
  const merged = { ...current, ...fields };
  db.prepare(`
    INSERT INTO call_state (phone, masechet, daf, amud, track, speed, updated_at)
    VALUES (@phone, @masechet, @daf, @amud, @track, @speed, datetime('now'))
    ON CONFLICT(phone) DO UPDATE SET
      masechet=excluded.masechet, daf=excluded.daf, amud=excluded.amud,
      track=excluded.track, speed=excluded.speed, updated_at=excluded.updated_at
  `).run({
    phone,
    masechet: merged.masechet ?? null,
    daf: merged.daf ?? null,
    amud: merged.amud ?? null,
    track: merged.track ?? 'gemara',
    speed: merged.speed ?? 1.0,
  });
}

function getCallState(phone) {
  return db.prepare('SELECT * FROM call_state WHERE phone = ?').get(phone) || null;
}

function savePosition(phone, masechet, daf, amud, track, offsetMs) {
  db.prepare(`
    INSERT INTO positions (phone, masechet, daf, amud, track, offset_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(phone, masechet, daf, amud, track) DO UPDATE SET
      offset_ms=excluded.offset_ms, updated_at=excluded.updated_at
  `).run(phone, masechet, daf, amud, track, offsetMs || 0);
}

function getPosition(phone, masechet, daf, amud, track) {
  const row = db.prepare(`
    SELECT offset_ms FROM positions WHERE phone=? AND masechet=? AND daf=? AND amud=? AND track=?
  `).get(phone, masechet, daf, amud, track);
  return row ? row.offset_ms : 0;
}

module.exports = { setCallState, getCallState, savePosition, getPosition };
