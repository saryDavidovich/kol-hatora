// server/jobs.js
//
// מעקב פשוט (בזיכרון) אחר משימות רקע ארוכות (בניית אודיו/TTS, העלאה לימות),
// כדי שממשק הניהול יוכל להראות "בתהליך... 40%" ולא רק לתקוע spinner עיוור.
// מספיק לצרכי ממשק ניהול יחיד (לא בנוי למקביליות מרובת-שרתים).

const crypto = require('crypto');

const jobs = new Map(); // id -> { status, progress, message, result, error }

function createJob() {
  const id = crypto.randomBytes(8).toString('hex');
  jobs.set(id, { id, status: 'pending', progress: 0, message: '', result: null, error: null, createdAt: Date.now() });
  return id;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}

function getJob(id) {
  return jobs.get(id) || null;
}

/** מריץ פונקציה אסינכרונית כ"job" עם מעקב, בלי לחסום את הבקשה שיצרה אותה */
function runAsJob(fn) {
  const id = createJob();
  updateJob(id, { status: 'running', message: 'מתחיל...' });

  (async () => {
    try {
      const result = await fn((progress, message) => updateJob(id, { progress, message }));
      updateJob(id, { status: 'done', progress: 100, result, message: 'הושלם' });
    } catch (err) {
      updateJob(id, { status: 'error', error: err.message, message: `שגיאה: ${err.message}` });
    }
  })();

  return id;
}

// ניקוי jobs ישנים (מעל שעה) כדי לא לדלוף זיכרון בהרצה ארוכה
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000);

module.exports = { createJob, updateJob, getJob, runAsJob };
