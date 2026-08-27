// server/public/admin/admin.js
//
// SPA קל משקל (וניל, ללא framework/build-step - כדי שתפעיל את הכל בקלות
// ע"י הרצת השרת בלבד, גם אם אתה לא מכיר כלי בנייה). ניווט מבוסס hash:
//   #/                                     -> דשבורד (רשימת מסכתות)
//   #/masechet/<שם>                        -> רשימת דפים במסכת
//   #/daf/<מסכת>/<דף>/<עמוד>               -> עורך העמוד (גמרא/רש"י/תוספות)

const app = document.getElementById('app');

async function api(path, opts = {}) {
  const resp = await fetch(`/admin/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (resp.status === 401) {
    location.hash = '#/login';
    throw new Error('לא מחוברים');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `שגיאה (${resp.status})`);
  return data;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function topbar(activeCrumbs = '') {
  return `
    <div class="topbar">
      <div class="brand">📜 ניהול תוכן · ימות הש"ס</div>
      <nav>
        <a href="#/">דשבורד</a>
        <a href="#" id="logoutLink">התנתקות</a>
      </nav>
    </div>`;
}

async function render() {
  const hash = location.hash || '#/login';

  if (hash === '#/login') return renderLogin();

  // בדיקת חיבור לפני רינדור מסכי ניהול
  try {
    await api('/overview');
  } catch (e) {
    return renderLogin();
  }

  if (hash === '#/' || hash === '') return renderDashboard();

  const masechetMatch = hash.match(/^#\/masechet\/([^/]+)$/);
  if (masechetMatch) return renderMasechet(decodeURIComponent(masechetMatch[1]));

  const dafMatch = hash.match(/^#\/daf\/([^/]+)\/(\d+)\/([ab])$/);
  if (dafMatch) return renderDafEditor(decodeURIComponent(dafMatch[1]), parseInt(dafMatch[2], 10), dafMatch[3]);

  return renderDashboard();
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

// ==================== מסך כניסה ====================
function renderLogin() {
  app.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <h1>ניהול הש"ס</h1>
        <p>הזינו את קוד הכניסה</p>
        <input type="password" id="codeInput" placeholder="קוד כניסה" autofocus />
        <button class="primary" id="loginBtn">כניסה</button>
        <div class="login-error" id="loginError"></div>
      </div>
    </div>`;

  const codeInput = document.getElementById('codeInput');
  const doLogin = async () => {
    const code = codeInput.value.trim();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ code }) });
      location.hash = '#/';
      render();
    } catch (e) {
      errEl.textContent = e.message;
    }
  };
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  codeInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doLogin(); });
}

function attachTopbarHandlers() {
  const logoutLink = document.getElementById('logoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', async (ev) => {
      ev.preventDefault();
      await api('/logout', { method: 'POST' });
      location.hash = '#/login';
      render();
    });
  }
}

// ==================== דשבורד ====================
async function renderDashboard() {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const { masechtot } = await api('/overview');

  const cards = masechtot.map((m) => {
    const pct = m.totalAmudim ? Math.round((m.builtCount / m.totalAmudim) * 100) : 0;
    return `
      <a class="spine" href="#/masechet/${encodeURIComponent(m.masechet)}">
        <div class="name">${m.masechet}</div>
        <div class="progress-label">${m.builtCount} / ${m.totalAmudim} עמודים נבנו (${pct}%)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      </a>`;
  }).join('');

  document.querySelector('.content').innerHTML = `
    <h1 class="page-title">מסכתות</h1>
    <div class="shelf">${cards}</div>`;
}

// ==================== רשימת דפים במסכת ====================
async function renderMasechet(masechet) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const { dapim } = await api(`/masechet/${encodeURIComponent(masechet)}`);

  const statusClass = { 'לא התחיל': 'none', 'טיוטה': 'draft', 'נבנה': 'built' };

  const tiles = dapim.map((d) => {
    const amudHeb = d.amud === 'a' ? 'א' : 'ב';
    const cls = statusClass[d.status] || 'none';
    return `
      <a class="daf-tile" href="#/daf/${encodeURIComponent(masechet)}/${d.daf}/${d.amud}">
        <span class="status-dot ${cls}"></span>${d.daf}${amudHeb}
      </a>`;
  }).join('');

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb"><a href="#/">דשבורד</a> ← ${masechet}</div>
    <h1 class="page-title">${masechet}</h1>
    <div class="daf-grid">${tiles}</div>`;
}

// ==================== עורך עמוד ====================
async function renderDafEditor(masechet, daf, amud) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען עמוד...</div></div>`;
  attachTopbarHandlers();

  const data = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}`);
  const amudHeb = amud === 'a' ? 'א' : 'ב';

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb">
      <a href="#/">דשבורד</a> ← <a href="#/masechet/${encodeURIComponent(masechet)}">${masechet}</a> ← דף ${daf}${amudHeb}
    </div>
    <div class="daf-header">
      <div class="masechet-name">${masechet}</div>
      <div class="daf-loc">דף ${daf} עמוד ${amudHeb} &nbsp;·&nbsp; מקור: ${data.source === 'draft' ? 'טיוטה שמורה' : 'נמשך חי מוויקיטקסט'}</div>
    </div>

    <div class="page-frame">
      <div class="daf-columns">
        ${column('rashi', 'רש"י', data.rashi, data.rashi_error)}
        ${column('gemara', 'גמרא', data.gemara, data.gemara_error)}
        ${column('tosafot', 'תוספות', data.tosafot, data.tosafot_error)}
      </div>
    </div>

    <div class="daf-actions">
      <button class="primary" id="saveBtn">💾 שמור טיוטה</button>
      <button id="buildBtn">🔊 שלח ל-TTS ובנה אודיו</button>
      <button id="uploadBtn">☁️ העלה לימות</button>
    </div>
    <div class="job-status" id="jobStatus"></div>
  `;

  wireDafEditorEvents(masechet, daf, amud);
}

function column(track, label, text, error) {
  return `
    <div class="column ${track}">
      <div class="column-header">
        <span>${label}</span>
      </div>
      <div class="column-toolbar">
        <button data-action="refetch" data-track="${track}">↻ משוך מחדש</button>
        <button data-action="nikud" data-track="${track}">🔤 ניקוד (חינם)</button>
        <button data-action="punctuate" data-track="${track}" title="משתמש ב-Claude API - עולה כסף לפי כמות הטקסט">✒️ פיסוק (בתשלום)</button>
      </div>
      <textarea data-track="${track}" placeholder="אין תוכן עדיין...">${text || ''}</textarea>
      ${error ? `<div class="column-error">שגיאה בשליפה: ${error}</div>` : ''}
      <audio class="audio-preview" data-track="${track}" controls style="display:none"></audio>
    </div>`;
}

function wireDafEditorEvents(masechet, daf, amud) {
  const getTextarea = (track) => document.querySelector(`textarea[data-track="${track}"]`);
  const jobStatusEl = document.getElementById('jobStatus');

  // כפתורי "משוך מחדש" ו"הוסף ניקוד" בכל עמודה
  document.querySelectorAll('.column-toolbar button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const { action, track } = btn.dataset;
      const ta = getTextarea(track);
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '...';
      try {
        if (action === 'refetch') {
          const r = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/refetch/${track}`, { method: 'POST' });
          ta.value = r.text;
        } else if (action === 'nikud') {
          const r = await api('/nikud', { method: 'POST', body: JSON.stringify({ text: ta.value }) });
          ta.value = r.text;
        } else if (action === 'punctuate') {
          const r = await api('/punctuate', { method: 'POST', body: JSON.stringify({ text: ta.value }) });
          ta.value = r.text;
        }
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  // שמירת טיוטה
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const body = {
      gemara: getTextarea('gemara').value,
      rashi: getTextarea('rashi').value,
      tosafot: getTextarea('tosafot').value,
    };
    jobStatusEl.textContent = 'שומר...';
    jobStatusEl.className = 'job-status';
    try {
      await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/save`, { method: 'POST', body: JSON.stringify(body) });
      jobStatusEl.textContent = 'הטיוטה נשמרה ✓';
      jobStatusEl.className = 'job-status done';
    } catch (e) {
      jobStatusEl.textContent = `שגיאה: ${e.message}`;
      jobStatusEl.className = 'job-status error';
    }
  });

  // בניית TTS (job אסינכרוני עם polling)
  document.getElementById('buildBtn').addEventListener('click', async () => {
    const body = {
      gemara: getTextarea('gemara').value,
      rashi: getTextarea('rashi').value,
      tosafot: getTextarea('tosafot').value,
    };
    const { jobId } = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/build`, { method: 'POST', body: JSON.stringify(body) });
    await pollJob(jobId, jobStatusEl, () => {
      // אחרי בנייה - להראות נגני אודיו לכל track שקיים
      ['gemara', 'rashi', 'tosafot'].forEach((track) => {
        const audioEl = document.querySelector(`audio[data-track="${track}"]`);
        if (getTextarea(track).value.trim()) {
          audioEl.src = `/admin/api/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/audio/${track}?t=${Date.now()}`;
          audioEl.style.display = 'block';
        }
      });
    });
  });

  // העלאה לימות
  document.getElementById('uploadBtn').addEventListener('click', async () => {
    const { jobId } = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/upload`, { method: 'POST' });
    await pollJob(jobId, jobStatusEl);
  });
}

async function pollJob(jobId, statusEl, onDone) {
  statusEl.className = 'job-status';
  while (true) {
    const job = await api(`/jobs/${jobId}`);
    statusEl.textContent = `${job.message} (${job.progress}%)`;
    if (job.status === 'done') {
      statusEl.className = 'job-status done';
      if (onDone) onDone(job.result);
      return job.result;
    }
    if (job.status === 'error') {
      statusEl.className = 'job-status error';
      statusEl.textContent = `שגיאה: ${job.error}`;
      return null;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}
