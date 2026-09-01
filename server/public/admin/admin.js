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
        <a href="#/">🌳 עץ תפריטים</a>
        <a href="#/voices">⚙️ הגדרות קול</a>
        <a href="#/book">📚 עריכת ספר שלם</a>
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

  if (hash === '#/' || hash === '') return renderTreeEditor('root');
  if (hash === '#/voices') return renderVoiceSettings();
  if (hash === '#/book') return renderBookPicker();
  if (hash === '#/tree') return renderTreeEditor('root');
  const treeNodeMatch = hash.match(/^#\/tree\/([^/]+)$/);
  if (treeNodeMatch) return renderTreeEditor(treeNodeMatch[1]);
  const genericNodeMatch = hash.match(/^#\/node\/([^/]+)$/);
  if (genericNodeMatch) return renderNodeContentEditor(genericNodeMatch[1]);
  const wikisourceImportMatch = hash.match(/^#\/wikisource-import\/([^/]+)$/);
  if (wikisourceImportMatch) return renderWikisourceImport(wikisourceImportMatch[1]);
  const bookMatch = hash.match(/^#\/book\/([^/]+)$/);
  if (bookMatch) return renderBookEditor(decodeURIComponent(bookMatch[1]));

  const masechetMatch = hash.match(/^#\/masechet\/([^/]+)$/);
  if (masechetMatch) return renderMasechet(decodeURIComponent(masechetMatch[1]));

  const dafMatch = hash.match(/^#\/daf\/([^/]+)\/(\d+)\/([ab])$/);
  if (dafMatch) return renderDafEditor(decodeURIComponent(dafMatch[1]), parseInt(dafMatch[2], 10), dafMatch[3]);

  return renderTreeEditor('root');
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
      <button id="checkAbbrevBtn">🔍 בדוק ראשי תיבות</button>
      <button id="buildBtn">🔊 שלח ל-TTS ובנה אודיו</button>
      <button id="uploadBtn">☁️ העלה לימות</button>
    </div>
    <div class="job-status" id="jobStatus"></div>
    <div id="dafAbbrevArea" style="margin-top:1rem;"></div>
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
  const scopeKey = `daf:${daf}${amud}`;

  document.getElementById('checkAbbrevBtn').addEventListener('click', async () => {
    const texts = {
      gemara: getTextarea('gemara').value,
      rashi: getTextarea('rashi').value,
      tosafot: getTextarea('tosafot').value,
    };
    const area = document.getElementById('dafAbbrevArea');
    area.innerHTML = '<p>סורק...</p>';
    try {
      await api(`/book/${encodeURIComponent(masechet)}/scan-abbreviations`, {
        method: 'POST', body: JSON.stringify({ scope: 'daf', daf, amud, texts }),
      });
      await renderAbbrevCards(area, masechet, scopeKey);

      // כפתור "החל הגהות" ספציפי לדף הזה - מציבים בסוף האזור
      const applyBtn = document.createElement('button');
      applyBtn.className = 'primary';
      applyBtn.textContent = '✅ החל הגהות מאושרות על הטקסט';
      applyBtn.style.marginTop = '0.8rem';
      applyBtn.addEventListener('click', async () => {
        try {
          const r = await api(`/book/${encodeURIComponent(masechet)}/apply-abbreviations`, {
            method: 'POST', body: JSON.stringify({ scope: scopeKey, texts }),
          });
          getTextarea('gemara').value = r.texts.gemara || '';
          getTextarea('rashi').value = r.texts.rashi || '';
          getTextarea('tosafot').value = r.texts.tosafot || '';
          alert(`הוחלו ${r.appliedCount} הגהות - זכרו לשמור טיוטה!`);
        } catch (e) {
          alert(e.message);
        }
      });
      area.appendChild(applyBtn);
    } catch (e) {
      area.innerHTML = `<p class="column-error">שגיאה: ${e.message}</p>`;
    }
  });

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

// ==================== הגדרות קול ====================
async function renderVoiceSettings() {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען רשימת קולות מגוגל...</div></div>`;
  attachTopbarHandlers();

  let voices, current;
  try {
    [{ voices }, current] = await Promise.all([api('/voices'), api('/settings')]);
  } catch (e) {
    document.querySelector('.content').innerHTML = `
      <h1 class="page-title">הגדרות קול</h1>
      <p class="column-error">שגיאה בטעינת רשימת הקולות: ${e.message}</p>
      <p>ודאו ש-GOOGLE_TTS_API_KEY מוגדר נכון במשתני הסביבה, ושהפעלתם את Text-to-Speech API בפרויקט שלכם ב-Google Cloud.</p>`;
    return;
  }

  // ממיינים: WaveNet קודם (הזול והמומלץ), אחר כך השאר לפי שם
  const rank = (name) => (name.includes('Wavenet') ? 0 : name.includes('Standard') ? 1 : 2);
  voices.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));

  const options = voices.map((v) => {
    const tier = v.name.includes('Wavenet') ? 'WaveNet ($4/מיליון)'
      : v.name.includes('Standard') ? 'Standard ($4/מיליון)'
      : v.name.includes('Neural2') ? 'Neural2 ($16/מיליון)'
      : v.name.includes('Chirp') ? 'Chirp3 HD ($30/מיליון)' : '';
    return `<option value="${v.name}">${v.name} · ${v.ssmlGender === 'MALE' ? 'זכר' : 'נקבה'} · ${tier}</option>`;
  }).join('');

  document.querySelector('.content').innerHTML = `
    <h1 class="page-title">הגדרות קול</h1>
    <p>בחרו קול לטקסט רגיל (גמרא/רש"י/תוספות) וקול נפרד לטקסט מודגש
       (כותרות/ראשי דיבור). לחצו "▶ נגן דוגמה" כדי לשמוע לפני שבוחרים -
       בדיוק כמו שראיתם בכלי ה-Gemini, אבל מול הקולות האמיתיים של
       Google Cloud TTS שבהם המערכת בונה בפועל.</p>

    <div class="page-frame" style="max-width:600px">
      <div class="column" style="margin-bottom:1.5rem">
        <div class="column-header"><span>קול לטקסט רגיל</span></div>
        <select id="voiceNormalSelect" style="padding:0.6em;font-size:1rem">${options}</select>
        <div class="column-toolbar">
          <button id="previewNormal">▶ נגן דוגמה</button>
        </div>
        <audio id="audioNormal" class="audio-preview" controls style="display:none"></audio>
      </div>

      <div class="column">
        <div class="column-header"><span>קול לטקסט מודגש</span></div>
        <select id="voiceBoldSelect" style="padding:0.6em;font-size:1rem">${options}</select>
        <div class="column-toolbar">
          <button id="previewBold">▶ נגן דוגמה</button>
        </div>
        <audio id="audioBold" class="audio-preview" controls style="display:none"></audio>
      </div>
    </div>

    <div class="daf-actions">
      <button class="primary" id="saveVoicesBtn">💾 שמור כברירת מחדל</button>
    </div>
    <div class="job-status" id="voicesStatus"></div>
  `;

  if (current.voiceNormal) document.getElementById('voiceNormalSelect').value = current.voiceNormal;
  if (current.voiceBold) document.getElementById('voiceBoldSelect').value = current.voiceBold;

  async function preview(selectId, audioId, btn) {
    const voice = document.getElementById(selectId).value;
    const audioEl = document.getElementById(audioId);
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...מייצר';
    try {
      const resp = await fetch('/admin/api/voices/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'שגיאה');
      audioEl.src = `data:audio/wav;base64,${data.audioBase64}`;
      audioEl.style.display = 'block';
      audioEl.play();
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  document.getElementById('previewNormal').addEventListener('click', (e) => preview('voiceNormalSelect', 'audioNormal', e.target));
  document.getElementById('previewBold').addEventListener('click', (e) => preview('voiceBoldSelect', 'audioBold', e.target));

  document.getElementById('saveVoicesBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('voicesStatus');
    const voiceNormal = document.getElementById('voiceNormalSelect').value;
    const voiceBold = document.getElementById('voiceBoldSelect').value;
    try {
      await api('/settings', { method: 'POST', body: JSON.stringify({ voiceNormal, voiceBold }) });
      statusEl.textContent = 'נשמר ✓ - כל בנייה חדשה תשתמש בקולות האלה';
      statusEl.className = 'job-status done';
    } catch (e) {
      statusEl.textContent = `שגיאה: ${e.message}`;
      statusEl.className = 'job-status error';
    }
  });
}

// ==================== עזר: כרטיסי הגהת ראשי-תיבות (משותף) ====================
async function renderAbbrevCards(containerEl, masechet, scopeKey) {
  const { abbreviations } = await api(`/book/${encodeURIComponent(masechet)}/abbreviations?scope=${encodeURIComponent(scopeKey)}`);

  if (!abbreviations.length) {
    containerEl.innerHTML = '<p>לא נמצאו ראשי תיבות (או שעדיין לא נסרק).</p>';
    return;
  }

  containerEl.innerHTML = `
    <p>${abbreviations.length} ראשי תיבות נמצאו. ${abbreviations.filter(a => a.status === 'approved').length} כבר אושרו.</p>
    <div class="daf-grid" style="grid-template-columns: 1fr;">
      ${abbreviations.map((a) => `
        <div class="daf-tile" style="text-align:right; cursor:default;">
          <div style="font-weight:bold; margin-bottom:0.4em;">
            מקור: דף ${a.daf}${a.amud === 'a' ? 'א' : 'ב'} · ${a.track}
            ${a.status === 'approved' ? '<span style="color:var(--sage)"> ✓ אושר</span>' : ''}
          </div>
          <div style="font-size:0.85rem; color:var(--ink-soft); margin-bottom:0.5em;">
            ...${a.contextBefore} <strong style="color:var(--wine)">${a.abbreviation}</strong> ${a.contextAfter}...
          </div>
          <input type="text" data-id="${a.id}" value="${a.expansion}" style="width:100%; padding:0.4em; margin-bottom:0.4em;" />
          <button data-approve-id="${a.id}">✓ אשר</button>
        </div>
      `).join('')}
    </div>`;

  containerEl.querySelectorAll('[data-approve-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.approveId;
      const input = containerEl.querySelector(`input[data-id="${id}"]`);
      btn.disabled = true;
      try {
        await api(`/book/${encodeURIComponent(masechet)}/abbreviations/${id}/approve`, {
          method: 'POST', body: JSON.stringify({ expansion: input.value }),
        });
        btn.textContent = '✓ אושר';
        btn.style.background = 'var(--sage)';
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    });
  });
}

// ==================== בורר ספר (עריכת ספר שלם) ====================
function renderBookPicker() {
  app.innerHTML = `${topbar()}<div class="content">
    <h1 class="page-title">עריכת ספר שלם</h1>
    <p>הקלידו את שם המסכת (כמו שהיא מופיעה בתוכן - למשל "ברכות") ולחצו פתח.</p>
    <input type="text" id="masechetNameInput" placeholder="שם המסכת" style="padding:0.6em; font-size:1rem; margin-left:0.5em;" />
    <button class="primary" id="openBookBtn">פתח</button>
  </div>`;
  attachTopbarHandlers();

  const go = () => {
    const name = document.getElementById('masechetNameInput').value.trim();
    if (name) location.hash = `#/book/${encodeURIComponent(name)}`;
  };
  document.getElementById('openBookBtn').addEventListener('click', go);
  document.getElementById('masechetNameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ==================== עורך ספר שלם ====================
async function renderBookEditor(masechet) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const state = await api(`/book/${encodeURIComponent(masechet)}/state`);
  const amudimCount = Object.keys(state.amudim || {}).length;

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb"><a href="#/book">עריכת ספר שלם</a> ← ${masechet}</div>
    <h1 class="page-title">${masechet}</h1>

    <div class="page-frame" style="margin-bottom:1.5rem;">
      <h3>1. העלאת קובץ מסכת</h3>
      <p>קובץ HTML עם כותרות &lt;h1&gt; לשם המסכת ו-&lt;h2&gt;דף X.&lt;/h2&gt; לכל מעבר עמוד.
         נטענו כרגע <strong>${amudimCount}</strong> עמודים.</p>
      <input type="file" id="masechetFileInput" accept=".html,.htm,.txt" />
      <button class="primary" id="uploadFileBtn">העלה ופרק</button>
      <div class="job-status" id="uploadStatus"></div>
    </div>

    <div class="page-frame" style="margin-bottom:1.5rem;">
      <h3>2. הגהת ראשי תיבות</h3>
      <button id="scanBtn">🔍 סרוק ראשי תיבות בכל הספר</button>
      <button id="applyBtn">✅ החל הגהות מאושרות</button>
      <div class="job-status" id="abbrevStatus"></div>
      <div id="abbrevList" style="margin-top:1rem;"></div>
    </div>

    <div class="page-frame">
      <h3>3. בנייה והעלאה מרוכזת</h3>
      <button id="buildAllBtn">🔊 בנה TTS לכל הספר</button>
      <button id="uploadAllBtn">☁️ העלה הכל לימות</button>
      <div class="job-status" id="batchStatus"></div>
    </div>
  `;

  document.getElementById('uploadFileBtn').addEventListener('click', async () => {
    const fileInput = document.getElementById('masechetFileInput');
    const statusEl = document.getElementById('uploadStatus');
    if (!fileInput.files.length) return alert('בחרו קובץ קודם');

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    statusEl.textContent = 'מעלה ומפרק...';
    statusEl.className = 'job-status';
    try {
      const resp = await fetch(`/admin/api/book/${encodeURIComponent(masechet)}/upload-file`, {
        method: 'POST', credentials: 'include', body: formData,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      statusEl.textContent = `נטענו ${data.amudimCount} עמודים (${data.masechetName}) ✓`;
      statusEl.className = 'job-status done';
    } catch (e) {
      statusEl.textContent = `שגיאה: ${e.message}`;
      statusEl.className = 'job-status error';
    }
  });

  document.getElementById('scanBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('abbrevStatus');
    statusEl.textContent = 'סורק...';
    statusEl.className = 'job-status';
    try {
      const r = await api(`/book/${encodeURIComponent(masechet)}/scan-abbreviations`, {
        method: 'POST', body: JSON.stringify({ scope: 'book' }),
      });
      statusEl.textContent = `נמצאו ${r.count} ראשי תיבות ✓`;
      statusEl.className = 'job-status done';
      await renderAbbrevCards(document.getElementById('abbrevList'), masechet, 'book');
    } catch (e) {
      statusEl.textContent = `שגיאה: ${e.message}`;
      statusEl.className = 'job-status error';
    }
  });

  document.getElementById('applyBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('abbrevStatus');
    try {
      const r = await api(`/book/${encodeURIComponent(masechet)}/apply-abbreviations`, {
        method: 'POST', body: JSON.stringify({ scope: 'book' }),
      });
      statusEl.textContent = `הוחלו ${r.appliedCount} הגהות ✓`;
      statusEl.className = 'job-status done';
    } catch (e) {
      statusEl.textContent = `שגיאה: ${e.message}`;
      statusEl.className = 'job-status error';
    }
  });

  document.getElementById('buildAllBtn').addEventListener('click', async () => {
    const { jobId } = await api(`/book/${encodeURIComponent(masechet)}/build-all`, { method: 'POST', body: '{}' });
    await pollJob(jobId, document.getElementById('batchStatus'));
  });

  document.getElementById('uploadAllBtn').addEventListener('click', async () => {
    const { jobId } = await api(`/book/${encodeURIComponent(masechet)}/upload-all`, { method: 'POST', body: '{}' });
    await pollJob(jobId, document.getElementById('batchStatus'));
  });

  // אם כבר נסרקו ראשי תיבות בעבר - מציגים אותם מיד
  renderAbbrevCards(document.getElementById('abbrevList'), masechet, 'book').catch(() => {});
}

// ==================== עורך עץ תפריטים (ניווט תיקיות - drill-down) ====================

/** מוצא צומת בעץ + שרשרת האבות שלו (לצורך breadcrumb), בצד הלקוח */
function findNodeWithAncestors(tree, targetId, ancestors = []) {
  if (tree.id === targetId) return { node: tree, ancestors };
  for (const child of tree.children || []) {
    const found = findNodeWithAncestors(child, targetId, [...ancestors, { id: tree.id, name: tree.name }]);
    if (found) return found;
  }
  return null;
}

async function renderTreeEditor(nodeId) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const { tree, availableMasechtot } = await api('/menu-tree');
  const found = findNodeWithAncestors(tree, nodeId);
  if (!found) { location.hash = '#/tree'; return; }
  const { node, ancestors } = found;

  const breadcrumbHtml = [...ancestors, { id: node.id, name: node.id === 'root' ? 'עץ תפריטים' : node.name }]
    .map((a, i, arr) => i === arr.length - 1
      ? `<span>${a.name}</span>`
      : `<a href="#/tree/${a.id}">${a.name}</a>`)
    .join(' ← ');

  const isLeaf = !node.children || node.children.length === 0;

  const childrenListHtml = (node.children || []).map((child, i) => {
    const childType = child.type || (child.children && child.children.length ? 'folder' : 'file');
    const isFolder = childType === 'folder';
    const clickHref = isFolder ? `#/tree/${child.id}` : (child.contentRef ? `#/masechet/${encodeURIComponent(child.contentRef)}` : `#/node/${child.id}`);

    return `
      <div class="spine" data-node-id="${child.id}" draggable="true"
           style="display:flex; flex-direction:row; align-items:center; gap:0.5em; cursor:default;">
        <span data-drag-handle title="גררו לסידור מחדש" style="cursor:grab; font-size:1.3rem; opacity:0.7;">⠿</span>
        <div style="flex-grow:1; min-width:0;">
          ${clickHref
            ? `<a href="${clickHref}" style="color:inherit; text-decoration:none;"><div class="name">${isFolder ? '📁' : '📖'} ${child.name}</div></a>`
            : `<div class="name">📄 ${child.name}</div>`}
          <div class="progress-label">${isFolder ? `${child.children.length} תתי-סעיפים` : (child.contentRef ? `מקושר ל-${child.contentRef}` : 'קובץ תוכן - עדיין ריק')}</div>
        </div>
        <div style="display:flex; gap:0.3em; flex-wrap:wrap; align-items:center;">
          ${!isFolder ? `
            <select data-link-content="${child.id}" style="font-size:0.75rem;">
              <option value="">-- לא מקושר --</option>
              ${availableMasechtot.map((m) => `<option value="${m}" ${child.contentRef === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          ` : ''}
          <button data-action="rename" data-id="${child.id}" title="שנה שם">✏️</button>
          <button data-action="toggle-type" data-id="${child.id}" data-current-type="${childType}" title="שנה סוג (תיקייה/קובץ)">${isFolder ? '📁→📄' : '📄→📁'}</button>
          ${isFolder ? `<button data-action="wikisource-import" data-id="${child.id}" data-name="${child.name}" title="ייבוא אוטומטי מוויקיטקסט">🔗</button>` : ''}
          <button data-action="import-book" data-id="${child.id}" data-name="${child.name}" title="ייבוא קובץ טקסט (למשל למסכת גמרא)">📥</button>
          <button data-action="delete" data-id="${child.id}" title="מחק">🗑</button>
        </div>
      </div>`;
  }).join('');

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb">${breadcrumbHtml}</div>
    <h1 class="page-title">${node.id === 'root' ? 'עץ תפריטים' : node.name}</h1>
    <p>זהו התפריט שימות המשיח משמיע בפועל כאן, לפי הסדר שמופיע למטה - גררו
       כרטיס (מהאייקון ⠿) לשינוי הסדר. כל שינוי משפיע מיד על השיחה הבאה.
       ${isLeaf ? ' אין עדיין תתי-סעיפים כאן.' : ''}</p>

    <div id="childrenContainer" class="shelf" style="grid-template-columns: 1fr;">${childrenListHtml}</div>

    <div class="daf-actions">
      <input type="text" id="newChildName" placeholder="שם כרטיס חדש" style="padding:0.5em;" />
      <button class="primary" id="addChildBtn">+ הוסף כרטיס כאן</button>
    </div>
  `;

  const container = document.getElementById('childrenContainer');

  // --- גרירה לסידור מחדש (HTML5 drag & drop) ---
  let dragSrcId = null;
  container.addEventListener('dragstart', (ev) => {
    const card = ev.target.closest('.spine[data-node-id]');
    if (!card) return;
    dragSrcId = card.dataset.nodeId;
    ev.dataTransfer.effectAllowed = 'move';
  });
  container.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    const card = ev.target.closest('.spine[data-node-id]');
    if (!card || card.dataset.nodeId === dragSrcId) return;
    const rect = card.getBoundingClientRect();
    const before = (ev.clientY - rect.top) < rect.height / 2;
    card.parentNode.insertBefore(
      container.querySelector(`[data-node-id="${dragSrcId}"]`),
      before ? card : card.nextSibling
    );
  });
  container.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    const orderedIds = [...container.querySelectorAll('.spine[data-node-id]')].map((el) => el.dataset.nodeId);
    try {
      await api(`/menu-tree/node/${node.id}/reorder`, { method: 'POST', body: JSON.stringify({ orderedIds }) });
    } catch (e) {
      alert(e.message);
      renderTreeEditor(nodeId);
    }
  });

  container.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    try {
      if (action === 'rename') {
        const newName = prompt('שם חדש:');
        if (!newName) return;
        await api(`/menu-tree/node/${id}/rename`, { method: 'POST', body: JSON.stringify({ name: newName }) });
      } else if (action === 'delete') {
        if (!confirm('למחוק את הסעיף הזה וכל תתי-הסעיפים שלו?')) return;
        await api(`/menu-tree/node/${id}/delete`, { method: 'POST' });
      } else if (action === 'toggle-type') {
        const newType = btn.dataset.currentType === 'folder' ? 'file' : 'folder';
        await api(`/menu-tree/node/${id}/set-type`, { method: 'POST', body: JSON.stringify({ type: newType }) });
      } else if (action === 'import-book') {
        location.hash = `#/book/${encodeURIComponent(btn.dataset.name)}`;
        return;
      } else if (action === 'wikisource-import') {
        location.hash = `#/wikisource-import/${id}`;
        return;
      }
      renderTreeEditor(nodeId);
    } catch (e) {
      alert(e.message);
    }
  });

  container.addEventListener('change', async (ev) => {
    const select = ev.target.closest('select[data-link-content]');
    if (!select) return;
    try {
      await api(`/menu-tree/node/${select.dataset.linkContent}/link-content`, {
        method: 'POST', body: JSON.stringify({ contentRef: select.value || null }),
      });
      renderTreeEditor(nodeId);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById('addChildBtn').addEventListener('click', async () => {
    const input = document.getElementById('newChildName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api(`/menu-tree/node/${node.id}/add`, { method: 'POST', body: JSON.stringify({ name }) });
      renderTreeEditor(nodeId);
    } catch (e) {
      alert(e.message);
    }
  });
}

// ==================== עורך תוכן צומת גנרי (תוכן ראשי + תתי-תוכן) ====================

function nodeContentTrackBlock(trackId, trackName, text, sourceUrl, isMain) {
  return `
    <div class="page-frame" style="margin-bottom:1.2rem;" data-track-block="${trackId}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.6rem;">
        <h3 style="margin:0;">${isMain ? '📖 תוכן ראשי' : '📄 ' + trackName}</h3>
        ${!isMain ? `<button data-action="delete-sub" data-sub-id="${trackId}">🗑 מחק תת-תוכן</button>` : ''}
      </div>
      <label style="font-size:0.85rem; color:var(--ink-soft);">קישור מקור (אופציונלי - לתיעוד בלבד, לא נשלף אוטומטית):</label>
      <input type="text" data-source-url="${trackId}" value="${sourceUrl || ''}" placeholder="https://..." style="width:100%; padding:0.4em; margin-bottom:0.6em;" />
      <div class="column-toolbar" style="margin-bottom:0.5em;">
        <button data-action="nikud" data-track="${trackId}">🔤 ניקוד (חינם)</button>
        <button data-action="punctuate" data-track="${trackId}">✒️ פיסוק (בתשלום)</button>
        <button data-action="check-abbrev" data-track="${trackId}">🔍 בדוק ראשי תיבות</button>
        <label style="display:inline-block;">
          <input type="file" data-upload-target="${trackId}" accept=".html,.htm,.txt" style="display:none;" />
          <button type="button" data-action="trigger-upload" data-track="${trackId}">📁 העלה קובץ טקסט</button>
        </label>
      </div>
      <textarea data-track-text="${trackId}" rows="8" style="width:100%; padding:0.6em; font-size:1.1rem;" placeholder="הטקסט כאן...">${text || ''}</textarea>
      <audio data-track-audio="${trackId}" class="audio-preview" controls style="display:none; margin-top:0.5em;"></audio>
      <div data-abbrev-area="${trackId}" style="margin-top:0.6em;"></div>
    </div>`;
}

async function renderNodeContentEditor(nodeId) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const [content, { tree }] = await Promise.all([
    api(`/node-content/${nodeId}`),
    api('/menu-tree'),
  ]);
  const found = findNodeWithAncestors(tree, nodeId);
  const nodeName = found ? found.node.name : nodeId;
  const breadcrumbHtml = found
    ? [...found.ancestors, { id: nodeId, name: nodeName }]
        .map((a, i, arr) => i === arr.length - 1 ? `<span>${a.name}</span>` : `<a href="#/tree/${a.id}">${a.name}</a>`)
        .join(' ← ')
    : nodeName;

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb">${breadcrumbHtml}</div>
    <h1 class="page-title">${nodeName}</h1>

    <div id="tracksContainer">
      ${nodeContentTrackBlock('main', content.mainContent.name || 'תוכן ראשי', content.mainContent.text, content.mainContent.sourceUrl, true)}
      ${content.subContents.map((s) => nodeContentTrackBlock(s.id, s.name, s.text, s.sourceUrl, false)).join('')}
    </div>

    <div class="daf-actions">
      ${content.subContents.length ? `
        <p style="font-size:0.85rem; color:var(--ink-soft); margin-top:0.5em;">
          💡 בשיחה: תוך כדי השמעה, לחיצה על * פותחת תפריט, ואז 1-${Math.min(content.subContents.length, 7)}
          למעבר לתת-תוכן (לפי הסדר כאן), ו-8 לחזרה לתוכן הראשי.
          ${content.subContents.length > 7 ? '<br>⚠️ יש יותר מ-7 תתי-תוכן - רק 7 הראשונים נגישים דרך הקשה (מגבלת מקש בודד).' : ''}
        </p>
      ` : ''}
      <input type="text" id="newSubName" placeholder="שם תת-תוכן חדש (למשל: ביאור, תרגום)" style="padding:0.5em;" />
      <button id="addSubBtn">+ הוסף תת-תוכן</button>
    </div>

    <div class="daf-actions" style="margin-top:1rem;">
      <button class="primary" id="buildBtn">🔊 שלח ל-TTS ובנה אודיו</button>
      <button id="uploadBtn">☁️ העלה לימות</button>
    </div>
    <div class="job-status" id="nodeJobStatus"></div>
  `;

  wireNodeContentEvents(nodeId);
}

function wireNodeContentEvents(nodeId) {
  const getTextarea = (trackId) => document.querySelector(`textarea[data-track-text="${trackId}"]`);
  const jobStatusEl = document.getElementById('nodeJobStatus');

  document.getElementById('tracksContainer').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const { action } = btn.dataset;
    const trackId = btn.dataset.track || btn.dataset.subId;

    if (action === 'trigger-upload') {
      const fileInput = document.querySelector(`input[data-upload-target="${trackId}"]`);
      fileInput.click();
      return;
    }

    if (action === 'delete-sub') {
      if (!confirm('למחוק את תת-התוכן הזה?')) return;
      await api(`/node-content/${nodeId}/sub/${trackId}`, { method: 'DELETE' });
      return renderNodeContentEditor(nodeId);
    }

    const ta = getTextarea(trackId);
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '...';

    try {
      if (action === 'nikud') {
        const r = await api(`/node-content/${nodeId}/nikud`, { method: 'POST', body: JSON.stringify({ text: ta.value }) });
        ta.value = r.text;
      } else if (action === 'punctuate') {
        const r = await api(`/node-content/${nodeId}/punctuate`, { method: 'POST', body: JSON.stringify({ text: ta.value }) });
        ta.value = r.text;
      } else if (action === 'check-abbrev') {
        const results = await api(`/node-content/${nodeId}/scan-abbreviations`, { method: 'POST', body: '{}' });
        const found = results[trackId] || [];
        const area = document.querySelector(`[data-abbrev-area="${trackId}"]`);
        area.innerHTML = found.length
          ? found.map((a) => `<div style="font-size:0.85rem; color:var(--ink-soft); border-right:3px solid var(--gold); padding-right:0.5em; margin-bottom:0.3em;">...${a.contextBefore} <strong style="color:var(--wine);">${a.abbreviation}</strong> ${a.contextAfter}...</div>`).join('')
          : '<p style="font-size:0.85rem;">לא נמצאו ראשי תיבות.</p>';
      }
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  // שמירת קישור מקור בעת יציאה מהשדה
  document.getElementById('tracksContainer').addEventListener('blur', async (ev) => {
    const input = ev.target.closest('input[data-source-url]');
    if (!input) return;
    const trackId = input.dataset.sourceUrl;
    if (trackId === 'main') {
      await api(`/node-content/${nodeId}/main`, { method: 'POST', body: JSON.stringify({ sourceUrl: input.value }) });
    } else {
      await api(`/node-content/${nodeId}/sub/${trackId}`, { method: 'POST', body: JSON.stringify({ sourceUrl: input.value }) });
    }
  }, true);

  // שמירת טקסט בעת יציאה מהשדה
  document.getElementById('tracksContainer').addEventListener('blur', async (ev) => {
    const ta = ev.target.closest('textarea[data-track-text]');
    if (!ta) return;
    const trackId = ta.dataset.trackText;
    if (trackId === 'main') {
      await api(`/node-content/${nodeId}/main`, { method: 'POST', body: JSON.stringify({ text: ta.value }) });
    } else {
      await api(`/node-content/${nodeId}/sub/${trackId}`, { method: 'POST', body: JSON.stringify({ text: ta.value }) });
    }
  }, true);

  // העלאת קובץ לכל track
  document.querySelectorAll('input[data-upload-target]').forEach((fileInput) => {
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files.length) return;
      const trackId = fileInput.dataset.uploadTarget;
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      formData.append('target', trackId);
      try {
        const resp = await fetch(`/admin/api/node-content/${nodeId}/upload-file`, {
          method: 'POST', credentials: 'include', body: formData,
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        document.querySelector(`textarea[data-track-text="${trackId}"]`).value = data.text;
      } catch (e) {
        alert(e.message);
      }
    });
  });

  document.getElementById('addSubBtn').addEventListener('click', async () => {
    const input = document.getElementById('newSubName');
    if (!input.value.trim()) return;
    await api(`/node-content/${nodeId}/sub`, { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
    renderNodeContentEditor(nodeId);
  });

  document.getElementById('buildBtn').addEventListener('click', async () => {
    const { jobId } = await api(`/node-content/${nodeId}/build`, { method: 'POST', body: '{}' });
    await pollJob(jobId, jobStatusEl, () => {
      document.querySelectorAll('audio[data-track-audio]').forEach((audioEl) => {
        const trackId = audioEl.dataset.trackAudio;
        audioEl.src = `/admin/api/node-content/${nodeId}/audio/${trackId}?t=${Date.now()}`;
        audioEl.style.display = 'block';
      });
    });
  });

  document.getElementById('uploadBtn').addEventListener('click', async () => {
    const { jobId } = await api(`/node-content/${nodeId}/upload`, { method: 'POST', body: '{}' });
    await pollJob(jobId, jobStatusEl);
  });
}

// ==================== ייבוא מוויקיטקסט (לצומת תיקייה) ====================

async function renderWikisourceImport(nodeId) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const [{ tree }, torahInfo] = await Promise.all([
    api('/menu-tree'),
    api('/wikisource-import/torah-sfarim'),
  ]);
  const found = findNodeWithAncestors(tree, nodeId);
  const node = found ? found.node : null;
  if (!node) { location.hash = '#/tree'; return; }

  const childrenNames = (node.children || []).map((c) => c.name);

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb">${found.ancestors.map((a) => `<a href="#/tree/${a.id}">${a.name}</a>`).join(' ← ')} ← ${node.name}</div>
    <h1 class="page-title">🔗 ייבוא מוויקיטקסט - ${node.name}</h1>
    <p>ייבוא אוטומטי לכל ${childrenNames.length} תתי-הסעיפים הקיימים כאן: <strong>${childrenNames.join(', ')}</strong></p>

    <div class="page-frame" style="margin-bottom:1rem;">
      <label><input type="radio" name="importMode" value="torah" checked /> תורה (תבניות מאומתות, כולל חיבור פרקים אוטומטי לפי פרשה)</label><br>
      <label><input type="radio" name="importMode" value="custom" /> מותאם אישית (כל ספר אחר - דורש בדיקה ידנית!)</label>
    </div>

    <div id="torahConfig" class="page-frame" style="margin-bottom:1rem;">
      <label>שם הספר (חומש):</label>
      <select id="torahSefer" style="padding:0.4em;">
        ${torahInfo.sfarim.map((s) => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <p style="margin-top:0.6em;">מפרשים לכלול:</p>
      ${torahInfo.commentators.map((c) => `<label style="display:block;"><input type="checkbox" class="torahCommentator" value="${c}" checked /> ${c}</label>`).join('')}
      <p style="font-size:0.85rem; color:var(--ink-soft); margin-top:0.6em;">
        ⚠️ הטקסט עשוי לכלול "עודף" בתחילת/סוף כל פרשה (חלק מהפרשה השכנה, כי פרשה
        לא תמיד נגמרת בדיוק בסוף פרק) - יש לבדוק ולתקן ידנית בעורך התוכן אחרי הייבוא.
      </p>
    </div>

    <div id="customConfig" class="page-frame" style="margin-bottom:1rem; display:none;">
      <label>שם הספר (כפי שמופיע בכתובות ויקיטקסט):</label>
      <input type="text" id="customSefer" placeholder="למשל: אורח חיים" style="width:100%; padding:0.4em; margin-bottom:0.6em;" />
      <label>תבנית כתובת לתוכן הראשי (השתמשו ב-{sefer} וב-{item}):</label>
      <input type="text" id="customMainTemplate" placeholder="למשל: שולחן ערוך/{sefer}/{item}" style="width:100%; padding:0.4em; margin-bottom:0.6em;" />
      <button id="testMainTemplateBtn">🧪 בדוק תבנית (על "${childrenNames[0] || ''}")</button>
      <div id="testMainResult" style="margin-top:0.5em; font-size:0.85rem;"></div>

      <p style="margin-top:1rem;">מפרשים (שם + תבנית לכל אחד):</p>
      <div id="customCommentatorsList"></div>
      <button id="addCustomCommentatorBtn">+ הוסף מפרש</button>
    </div>

    <button class="primary" id="startImportBtn">🚀 התחל ייבוא</button>
    <div class="job-status" id="importJobStatus"></div>
    <div id="importResults" style="margin-top:1rem;"></div>
  `;

  document.querySelectorAll('input[name="importMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isTorah = document.querySelector('input[name="importMode"]:checked').value === 'torah';
      document.getElementById('torahConfig').style.display = isTorah ? 'block' : 'none';
      document.getElementById('customConfig').style.display = isTorah ? 'none' : 'block';
    });
  });

  function addCommentatorRow(name = '', template = '') {
    const list = document.getElementById('customCommentatorsList');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:0.4em; margin-bottom:0.4em;';
    row.innerHTML = `
      <input type="text" class="comName" placeholder="שם המפרש" value="${name}" style="width:30%; padding:0.4em;" />
      <input type="text" class="comTemplate" placeholder="תבנית (עם {sefer} ו-{item})" value="${template}" style="flex-grow:1; padding:0.4em;" />
      <button data-remove-row>🗑</button>
    `;
    row.querySelector('[data-remove-row]').addEventListener('click', () => row.remove());
    list.appendChild(row);
  }
  document.getElementById('addCustomCommentatorBtn').addEventListener('click', () => addCommentatorRow());

  document.getElementById('testMainTemplateBtn').addEventListener('click', async () => {
    const resultEl = document.getElementById('testMainResult');
    resultEl.textContent = 'בודק...';
    try {
      const r = await api('/wikisource-import/test-template', {
        method: 'POST',
        body: JSON.stringify({
          template: document.getElementById('customMainTemplate').value,
          sefer: document.getElementById('customSefer').value,
          item: childrenNames[0],
        }),
      });
      resultEl.innerHTML = `<strong>נמצא: ${r.title}</strong><br>${r.sample}`;
    } catch (e) {
      resultEl.innerHTML = `<span class="column-error">שגיאה: ${e.message}</span>`;
    }
  });

  document.getElementById('startImportBtn').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="importMode"]:checked').value;
    const statusEl = document.getElementById('importJobStatus');
    const body = { mode };

    if (mode === 'torah') {
      body.sefer = document.getElementById('torahSefer').value;
      body.commentators = [...document.querySelectorAll('.torahCommentator:checked')].map((cb) => ({ name: cb.value }));
    } else {
      body.sefer = document.getElementById('customSefer').value;
      body.mainTemplate = document.getElementById('customMainTemplate').value;
      body.commentators = [...document.querySelectorAll('#customCommentatorsList > div')].map((row) => ({
        name: row.querySelector('.comName').value,
        template: row.querySelector('.comTemplate').value,
      })).filter((c) => c.name && c.template);
    }

    if (!confirm(`לייבא ל-${childrenNames.length} תתי-סעיפים? זה עשוי לקחת כמה דקות (וויקיטקסט מגביל קצב בקשות).`)) return;

    const { jobId } = await api(`/wikisource-import/${nodeId}/import`, { method: 'POST', body: JSON.stringify(body) });
    const result = await pollJob(jobId, statusEl);
    if (result && result.results) {
      document.getElementById('importResults').innerHTML = result.results.map((r) => `
        <div style="padding:0.4em; border-right:3px solid ${r.ok ? 'var(--sage)' : 'var(--wine)'}; margin-bottom:0.3em;">
          <strong>${r.name}</strong> ${r.ok ? '✓' : '✗'}
          ${r.errors.length ? `<div style="font-size:0.85rem; color:var(--wine);">${r.errors.join('; ')}</div>` : ''}
        </div>
      `).join('');
    }
  });
}
