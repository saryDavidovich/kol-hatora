// server/jobs.js
//
// הרצת פעולות ארוכות (בניית TTS, העלאה לימות) ברקע, עם מעקב התקדמות
// שהממשק יכול לבדוק (polling) בלי לחכות לתשובה סינכרונית.

const crypto = require('crypto');
const jobs = new Map();

function runAsJob(fn) {
  const jobId = crypto.randomBytes(8).toString('hex');
  jobs.set(jobId, { status: 'running', progress: 0, message: 'מתחיל...', result: null, error: null });

  const progress = (pct, message) => {
    const job = jobs.get(jobId);
    if (job) { job.progress = pct; job.message = message; }
  };

  fn(progress)
    .then((result) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'done'; job.progress = 100; job.result = result; }
    })
    .catch((err) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
    });

  return jobId;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = { runAsJob, getJob };
