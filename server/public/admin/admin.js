const app = document.getElementById('app');

async function api(pathSuffix, opts = {}) {
  const resp = await fetch(`/admin/api${pathSuffix}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `שגיאה (${resp.status})`);
  return data;
}

function topbar() {
  return `
    <div class="topbar">
      <strong>ימות הש"ס - ניהול</strong>
      <nav>
        <a href="#/">🌳 עץ תפריטים</a>
        <a href="#/voices">⚙️ הגדרות קול</a>
        <a href="#/prompts">🎙️ הפקת הודעות</a>
        <a href="#" id="logoutLink">התנתקות</a>
      </nav>
    </div>`;
}

function attachTopbarHandlers() {
  const logoutLink = document.getElementById('logoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/admin/api/logout', { method: 'POST', credentials: 'include' });
      render();
    });
  }
}

// ==================== התחברות ====================
async function renderLogin() {
  app.innerHTML = `
    <div class="login-box">
      <h2>כניסה לניהול</h2>
      <input type="password" id="codeInput" placeholder="קוד גישה" />
      <button class="primary" id="loginBtn" style="width:100%;">כניסה</button>
      <div id="loginError" style="color:var(--wine); margin-top:0.6em;"></div>
    </div>`;
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}
async function doLogin() {
  const code = document.getElementById('codeInput').value;
  const errEl = document.getElementById('loginError');
  try {
    const resp = await fetch('/admin/api/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!resp.ok) throw new Error((await resp.json()).error || 'כשל בכניסה');
    render();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// ==================== עורך עץ תפריטים (drill-down) ====================
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

  const { tree } = await api('/menu-tree');
  const found = findNodeWithAncestors(tree, nodeId);
  if (!found) { location.hash = '#/'; return; }
  const { node, ancestors } = found;

  const breadcrumbHtml = [...ancestors, { id: node.id, name: node.id === 'root' ? 'עץ תפריטים' : node.name }]
    .map((a, i, arr) => i === arr.length - 1 ? `<span>${a.name}</span>` : `<a href="#/tree/${a.id}">${a.name}</a>`)
    .join(' ← ');

  const isLeafRoot = !node.children || node.children.length === 0;

  const childrenListHtml = (node.children || []).map((child) => {
    const childIsFolder = child.children && child.children.length > 0;
    const clickHref = childIsFolder
      ? `#/tree/${child.id}`
      : (child.contentRef ? `#/masechet/${encodeURIComponent(child.contentRef)}` : null);

    return `
      <div class="spine" data-node-id="${child.id}" draggable="true" style="display:flex; flex-direction:row; align-items:center; gap:0.5em;">
        <span data-drag-handle title="גררו לסידור מחדש" style="cursor:grab; font-size:1.3rem; opacity:0.7;">⠿</span>
        <div style="flex-grow:1; min-width:0;">
          ${clickHref
            ? `<a href="${clickHref}" style="color:inherit; text-decoration:none;"><div class="name">${childIsFolder ? '📁' : '📖'} ${child.name}</div></a>`
            : `<div class="name">📄 ${child.name}</div>`}
          <div class="progress-label">${childIsFolder ? `${child.children.length} תתי-סעיפים` : (child.contentRef ? `מקושר ל-${child.contentRef}` : 'לא מקושר')}</div>
        </div>
        <button data-action="rename" data-id="${child.id}" title="שנה שם">✏️</button>
        <button data-action="delete" data-id="${child.id}" title="מחק">🗑</button>
      </div>`;
  }).join('');

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb">${breadcrumbHtml}</div>
    <h1 class="page-title">${node.id === 'root' ? 'עץ תפריטים' : node.name}</h1>
    <p>זהו התפריט שימות המשיח משמיע בפועל כאן, לפי הסדר שמופיע למטה - גררו כרטיס לשינוי הסדר.
       ${isLeafRoot ? ' אין עדיין תתי-סעיפים כאן.' : ''}</p>

    ${node.id === 'root' ? `
      <div class="page-frame" style="margin-bottom:1rem;">
        <button id="resetTreeBtn">🔄 אפס עץ לברירת מחדל (מוחק כל שינוי!)</button>
        <div id="resetStatus" style="margin-top:0.4em; font-size:0.85rem;"></div>
      </div>
    ` : ''}

    <div id="childrenContainer" style="display:flex; flex-direction:column; gap:0.5em;">${childrenListHtml}</div>

    <div class="daf-actions">
      <input type="text" id="newChildName" placeholder="שם כרטיס חדש" style="padding:0.5em;" />
      <button class="primary" id="addChildBtn">+ הוסף כרטיס כאן</button>
    </div>
  `;

  if (node.id === 'root') {
    document.getElementById('resetTreeBtn').addEventListener('click', async () => {
      if (!confirm('זה ימחק את כל השינויים בעץ ויחזיר אותו למבנה המקורי (6 סדרים, 38 מסכתות). להמשיך?')) return;
      const statusEl = document.getElementById('resetStatus');
      statusEl.textContent = 'מאפס...';
      try {
        await api('/menu-tree/reset-to-seed', { method: 'POST', body: '{}' });
        statusEl.textContent = 'אופס בהצלחה ✓';
        renderTreeEditor(nodeId);
      } catch (e) {
        statusEl.textContent = `שגיאה: ${e.message}`;
      }
    });
  }

  const container = document.getElementById('childrenContainer');
  let dragSrcId = null;
  container.addEventListener('dragstart', (ev) => {
    const card = ev.target.closest('.spine[data-node-id]');
    if (!card) return;
    dragSrcId = card.dataset.nodeId;
  });
  container.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    const card = ev.target.closest('.spine[data-node-id]');
    if (!card || card.dataset.nodeId === dragSrcId) return;
    const rect = card.getBoundingClientRect();
    const before = (ev.clientY - rect.top) < rect.height / 2;
    card.parentNode.insertBefore(container.querySelector(`[data-node-id="${dragSrcId}"]`), before ? card : card.nextSibling);
  });
  container.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    const orderedIds = [...container.querySelectorAll('.spine[data-node-id]')].map((el) => el.dataset.nodeId);
    try {
      await api(`/menu-tree/node/${node.id}/reorder`, { method: 'POST', body: JSON.stringify({ orderedIds }) });
    } catch (e) { alert(e.message); renderTreeEditor(nodeId); }
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
      }
      renderTreeEditor(nodeId);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('addChildBtn').addEventListener('click', async () => {
    const input = document.getElementById('newChildName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api(`/menu-tree/node/${node.id}/add`, { method: 'POST', body: JSON.stringify({ name }) });
      renderTreeEditor(nodeId);
    } catch (e) { alert(e.message); }
  });
}

// ==================== רשימת דפי מסכת ====================
async function renderMasechet(masechet) {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען...</div></div>`;
  attachTopbarHandlers();

  const { dapim } = await api(`/masechet/${encodeURIComponent(masechet)}`);
  const statusClass = { 'לא התחיל': 'none', 'טיוטה': 'draft', 'נבנה': 'built' };

  const tiles = dapim.map((d) => {
    const amudHeb = d.amud === 'a' ? 'א' : 'ב';
    const cls = statusClass[d.status] || 'none';
    return `<a class="daf-tile" href="#/daf/${encodeURIComponent(masechet)}/${d.daf}/${d.amud}"><span class="status-dot ${cls}"></span>${d.daf}${amudHeb}</a>`;
  }).join('');

  document.querySelector('.content').innerHTML = `
    <div class="breadcrumb"><a href="#/">עץ תפריטים</a> ← ${masechet}</div>
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
    <div class="breadcrumb"><a href="#/">עץ תפריטים</a> ← <a href="#/masechet/${encodeURIComponent(masechet)}">${masechet}</a> ← דף ${daf}${amudHeb}</div>
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
      <div class="column-header"><span>${label}</span></div>
      <div class="column-toolbar">
        <button data-action="refetch" data-track="${track}">↻ משוך מחדש</button>
        <button data-action="nikud" data-track="${track}">🔤 ניקוד (חינם)</button>
        <button data-action="punctuate" data-track="${track}" title="משתמש ב-Claude API - עולה כסף">✒️ פיסוק (בתשלום)</button>
      </div>
      <textarea data-track="${track}" placeholder="אין תוכן עדיין...">${text || ''}</textarea>
      ${error ? `<div class="column-error">שגיאה בשליפה: ${error}</div>` : ''}
    </div>`;
}

async function pollJob(jobId, statusEl, onDone) {
  statusEl.textContent = 'מתחיל...';
  statusEl.className = 'job-status';
  while (true) {
    const job = await api(`/jobs/${jobId}`);
    statusEl.textContent = `${job.message || ''} (${job.progress || 0}%)`;
    if (job.status === 'done') {
      statusEl.className = 'job-status done';
      statusEl.textContent = job.message || 'הושלם';
      if (onDone) onDone();
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

function wireDafEditorEvents(masechet, daf, amud) {
  const getTextarea = (track) => document.querySelector(`textarea[data-track="${track}"]`);
  const jobStatusEl = document.getElementById('jobStatus');

  // מצב הסריקה הנוכחית - נשמר בזיכרון בין הסריקה לעדכון הסופי
  let abbrevState = null; // { gemara: {originalText, items: [...]}, rashi: {...}, tosafot: {...} }

  function renderAbbrevArea() {
    const area = document.getElementById('dafAbbrevArea');
    const trackLabels = { gemara: 'גמרא', rashi: 'רש"י', tosafot: 'תוספות' };
    let anyFound = false;

    const html = ['gemara', 'rashi', 'tosafot'].map((track) => {
      const items = abbrevState[track].items;
      if (!items.length) return '';
      anyFound = true;
      const rows = items.map((item, i) => `
        <div style="display:flex; align-items:center; gap:0.5em; flex-wrap:wrap; background:${item.approved ? '#eef5ee' : '#fffdf7'}; border:1px solid var(--rule); border-radius:6px; padding:0.5em 0.7em; margin-bottom:0.4em;">
          <div style="flex-grow:1; min-width:200px; font-size:0.85rem; color:var(--ink-soft);">
            ...${item.contextBefore} <strong style="color:var(--wine);">${item.abbreviation}</strong> ${item.contextAfter}...
          </div>
          <input type="text" data-abbrev-input data-track="${track}" data-idx="${i}" value="${item.expansion}"
                 ${item.approved ? 'disabled' : ''} style="width:180px; padding:0.4em;" />
          ${item.approved
            ? `<button data-action="edit-again" data-track="${track}" data-idx="${i}">✏️ ערוך מחדש</button> <span style="color:var(--sage);">✓ אושר</span>`
            : `<button data-action="approve" data-track="${track}" data-idx="${i}">✓ אישור</button>`}
        </div>`).join('');
      return `<div style="margin-bottom:1em;"><strong>${trackLabels[track]}:</strong>${rows}</div>`;
    }).join('');

    if (!anyFound) {
      area.innerHTML = '<p>לא נמצאו ראשי תיבות.</p>';
      return;
    }

    area.innerHTML = html + `
      <button class="primary" id="applyAbbrevBtn">✅ עדכן הכל (החל את כל האישורים על הטקסט)</button>
      <span id="applyAbbrevStatus" style="margin-inline-start:0.6em; font-size:0.85rem;"></span>
    `;

    area.querySelectorAll('[data-action="approve"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { track, idx } = btn.dataset;
        const input = area.querySelector(`input[data-abbrev-input][data-track="${track}"][data-idx="${idx}"]`);
        abbrevState[track].items[idx].expansion = input.value;
        abbrevState[track].items[idx].approved = true;
        renderAbbrevArea();
      });
    });
    area.querySelectorAll('[data-action="edit-again"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { track, idx } = btn.dataset;
        abbrevState[track].items[idx].approved = false;
        renderAbbrevArea();
      });
    });

    document.getElementById('applyAbbrevBtn').addEventListener('click', () => {
      const statusEl = document.getElementById('applyAbbrevStatus');
      let appliedCount = 0;
      for (const track of ['gemara', 'rashi', 'tosafot']) {
        const { originalText, items } = abbrevState[track];
        const approvedSorted = items.filter((it) => it.approved).sort((a, b) => b.charIndex - a.charIndex);
        if (!approvedSorted.length) continue;
        let text = originalText;
        for (const it of approvedSorted) {
          text = text.slice(0, it.charIndex) + it.expansion + text.slice(it.charEndIndex);
          appliedCount++;
        }
        getTextarea(track).value = text;
      }
      statusEl.textContent = appliedCount ? `הוחלו ${appliedCount} תיקונים - זכרו לשמור טיוטה!` : 'לא אושרו תיקונים';
    });
  }

  document.getElementById('checkAbbrevBtn').addEventListener('click', async () => {
    const texts = { gemara: getTextarea('gemara').value, rashi: getTextarea('rashi').value, tosafot: getTextarea('tosafot').value };
    const area = document.getElementById('dafAbbrevArea');
    area.innerHTML = '<p>סורק...</p>';
    try {
      const results = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/check-abbreviations`, {
        method: 'POST', body: JSON.stringify(texts),
      });
      abbrevState = {};
      for (const track of ['gemara', 'rashi', 'tosafot']) {
        abbrevState[track] = {
          originalText: texts[track],
          items: results[track].map((a) => ({ ...a, expansion: a.abbreviation, approved: false })),
        };
      }
      renderAbbrevArea();
    } catch (e) {
      area.innerHTML = `<p class="column-error">שגיאה: ${e.message}</p>`;
    }
  });

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

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const texts = { gemara: getTextarea('gemara').value, rashi: getTextarea('rashi').value, tosafot: getTextarea('tosafot').value };
    try {
      await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/save`, { method: 'POST', body: JSON.stringify(texts) });
      jobStatusEl.className = 'job-status done';
      jobStatusEl.textContent = 'נשמר ✓';
    } catch (e) { alert(e.message); }
  });

  document.getElementById('buildBtn').addEventListener('click', async () => {
    const texts = { gemara: getTextarea('gemara').value, rashi: getTextarea('rashi').value, tosafot: getTextarea('tosafot').value };
    const { jobId } = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/build`, { method: 'POST', body: JSON.stringify(texts) });
    await pollJob(jobId, jobStatusEl);
  });

  document.getElementById('uploadBtn').addEventListener('click', async () => {
    const { jobId } = await api(`/daf/${encodeURIComponent(masechet)}/${daf}/${amud}/upload`, { method: 'POST', body: '{}' });
    await pollJob(jobId, jobStatusEl);
  });
}

// ==================== הגדרות קול ====================
async function renderVoiceSettings() {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען קולות...</div></div>`;
  attachTopbarHandlers();

  const { voices, current } = await api('/voices');

  const rows = voices.map((v) => `
    <div class="page-frame" style="margin-bottom:0.6rem; display:flex; align-items:center; gap:1em; flex-wrap:wrap;">
      <div style="flex-grow:1; min-width:200px;">
        <strong>${v.name}</strong><br>
        <span style="font-size:0.85rem; color:var(--ink-soft);">
          קול ${v.genderHe} &nbsp;·&nbsp; ${v.tierLabel}
          ${v.pricePerMillionChars != null ? `&nbsp;·&nbsp; $${v.pricePerMillionChars} ל-מיליון תווים` : ''}
        </span>
      </div>
      <label style="font-size:0.85rem;"><input type="radio" name="voiceNormalRadio" value="${v.name}" ${v.name === current.voiceNormal ? 'checked' : ''} /> רגיל</label>
      <label style="font-size:0.85rem;"><input type="radio" name="voiceBoldRadio" value="${v.name}" ${v.name === current.voiceBold ? 'checked' : ''} /> מודגש</label>
      <button data-sample="${v.name}">🔊 השמע דוגמה</button>
    </div>`).join('');

  document.querySelector('.content').innerHTML = `
    <h1 class="page-title">⚙️ הגדרות קול</h1>
    <p style="font-size:0.9rem; color:var(--ink-soft);">
      "רגיל" = הקול שמקריא את רוב הטקסט. "מודגש" = הקול לדיבור-המתחיל (מילים מודגשות ב-'''...''').
      המחירים לפי תמחור גוגל הפומבי (יכולים להשתנות).
    </p>
    ${rows}
    <div class="daf-actions">
      <button class="primary" id="saveVoicesBtn">💾 שמור בחירה</button>
    </div>
    <div class="job-status" id="voiceStatus"></div>
    <audio id="sampleAudio" controls style="display:none; margin-top:0.5em; width:100%; position:sticky; bottom:1em;"></audio>
  `;

  const sampleAudio = document.getElementById('sampleAudio');
  document.querySelectorAll('[data-sample]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const voiceName = btn.dataset.sample;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'טוען...';
      try {
        const r = await api('/voices/sample', { method: 'POST', body: JSON.stringify({ voiceName }) });
        sampleAudio.src = `data:audio/mp3;base64,${r.audioBase64}`;
        sampleAudio.style.display = 'block';
        sampleAudio.play();
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });

  document.getElementById('saveVoicesBtn').addEventListener('click', async () => {
    const voiceNormal = document.querySelector('input[name="voiceNormalRadio"]:checked')?.value;
    const voiceBold = document.querySelector('input[name="voiceBoldRadio"]:checked')?.value;
    if (!voiceNormal) return alert('בחרו קול "רגיל" קודם');
    await api('/voices', { method: 'POST', body: JSON.stringify({ voiceNormal, voiceBold: voiceBold || voiceNormal }) });
    document.getElementById('voiceStatus').textContent = 'נשמר ✓';
    document.getElementById('voiceStatus').className = 'job-status done';
  });
}

// ==================== הפקת הודעות לקו ימות ====================
// רשימת ברירת המחדל: הודעות תמלול פון (004, 094, 150-182) בנוסח ובניקוד שנמסרו.
// הטקסט נשלח לקריין בדיוק כפי שהוא - בלי שום שינוי בניקוד.
const DEFAULT_PROMPTS = "004 | לְהַתְחָלַת הַקְלָטָה וְתִּמְלוּל הַקִּישׁוּ 1, לִטְעִינַת אַרְנָק וְעִדְכּוּן פְּרָטִים הַקִּישׁוּ 2, לְהֶסְבֵּר עַל אֹפֶן הַשִּׁמּוּשׁ בַּמַּעֲרֶכֶת הַקִּישׁוּ 3, לְהַקְלָטַת בְּרִירַת הַמַּחְדָּל שֶׁלָּכֶם הַקִּישׁוּ 4, לְהֶסְבֵּר עַל שְׁלִיחַת קְבָצִים דֶּרֶךְ הַמֵּיְיל הַקִּישׁוּ 5, לְהֶסְבֵּר עַל שְׁלִיחַת קִבְצֵי כְּתַב יָד דֶּרֶךְ הַמֵּיְיל הַקִּישׁוּ 6, לִכְנִיסָה עִם מִסְפַּר תַּלְמִיד הַקִּישׁוּ 7, לְהִיסְטוֹרְיַת הַמִּסְמָכִים הַקִּישׁוּ 8, לְהַשְׁאָרַת הוֹדָעָה הַקִּישׁוּ 9.\n094 | לִשְׁמִיעַת הוֹדָעוֹת הַקֵּשׁ 1 לְמַעֲבָר לִשְׁלוּחָה 59 הַקֵּשׁ 2 לְהַקְלָטָה עִם עֲרִיכָה הַקֵּשׁ 3.\n150 | לִשְׁמִירַת הַהַקְלָטָה וּשְׁלִיחָה לְתִּמְלוּל הַקִּישׁוּ 1, לְהַקְלָטָה מִחָדָשׁ הַקִּישׁוּ 2, לְהֶמְשֵׁךְ הַהַקְלָטָה הַקִּישׁוּ 3.\n151 | הַקְלִיטוּ מִחָדָשׁ לְאַחַר הַצְּלִיל, בְּסִיּוּם הַקִּישׁוּ סוּלָּמִית.\n152 | הַמְשִׁיכוּ לְהַקְלִיט לְאַחַר הַצְּלִיל, בְּסִיּוּם הַקִּישׁוּ סוּלָּמִית.\n153 | לֹא נִמְצְאוּ מִסְמָכִים קוֹדְמִים.\n154 | מִסְמָךְ.\n155 | מִתּוֹךְ.\n156 | תִּמְלוּל הַקְלָטָה.\n157 | זִיהוּי כְּתַב יָד\n158 | קַלְדָנוּת דִּיגִיטָלִית\n159 | מִתַּאֲרִיךְ\n160 | בְּאוֹרֶךְ\n161 | דַּקּוֹת\n162 | לְקַבָּלַת הַמִּסְמָךְ שׁוּב הַקִּישׁוּ 1, לַמִּסְמָךְ הַבָּא הַקִּישׁוּ 2, לַמִּסְמָךְ הַקּוֹדֵם הַקִּישׁוּ 3, לַחֲזָרָה לַתַּפְרִיט הָרָאשִׁי הַקִּישׁוּ 0.\n163 | הַמִּסְמָךְ נִשְׁלַח שׁוּב לַמֵּיְיל שֶׁלָּכֶם.\n164 | הַמִּסְמָךְ נִשְׁלַח שׁוּב לַפַקְס שֶׁלָּכֶם.\n165 | שְׁלִיחָה חוֹזֶרֶת לַפַקְס עוֹלָה\n166 | לְאִשּׁוּר הַקִּישׁוּ 1, לְבִטּוּל וַחֲזָרָה הַקִּישׁוּ 2.\n167 | אֲגוֹרוֹת.\n168 | שֶׁקֶל.\n169 | הַשְּׁלִיחָה בּוּטְלָה.\n170 | אֵין מַסְפִּיק יִתְּרָה לִשְׁלִיחָה בַּפַקְס.\n171 | לֹא מוּגְדָר מֵיְיל אוֹ פַקְס לִשְׁלִיחָה, נִיתָן לְעַדְכֵּן פְּרָטִים בִּשְׁלוּחָה 2 מִתַּפְרִיט רָאשִׁי.\n172 | הִגַּעְתֶּם לִמְסַפַּר הַשְּׁלִיחוֹת הַחוֹזְרוֹת הַמִּרְבִּי לְהַיּוֹם.\n173 | הַשְּׁלִיחָה נִכְשְׁלָה, נַסּוּ שׁוּב מְאֻחָר יוֹתֵר.\n174 | מִסְמָךְ אַחֲרוֹן.\n175 | מִסְמָךְ רִאשׁוֹן.\n176 | בְּאֹרֶךְ דַּקָּה אַחַת.\n177 | [צליל]\n178 | הַקְלָטָה עִם עֲרִיכָה. דַּבְּרוּ לְאַחַר הַצְּלִיל. לְעִצּוּב, הַקִּישׁוּ כּוֹכָבִית וּמִיָּד אֶת מִסְפַּר הַפְּעֻלָּה. לְתַפְרִיט הָעֲרִיכָה הַקִּישׁוּ פַּעֲמַיִם כּוֹכָבִית. לְסִיּוּם, הַקִּישׁוּ סוּלָּמִית.\n179 | תַּפְרִיט עֲרִיכָה. לִירִידַת שׁוּרָה הַקִּישׁוּ 1. לְהַדְגָּשָׁה הַקִּישׁוּ 2, וְשׁוּב 2 לְסִיּוּם הַהַדְגָּשָׁה. לְקַו תַּחְתּוֹן הַקִּישׁוּ 3, וְשׁוּב 3 לְסִיּוּם. לְסוֹגֵר מְרֻבָּע הַקִּישׁוּ 4 לִפְתִיחָה, וְשׁוּב 4 לִסְגִירָה. לְסוֹגֵר עָגוֹל הַקִּישׁוּ 5 לִפְתִיחָה, וְשׁוּב 5 לִסְגִירָה. לַמַּקָּף הַקִּישׁוּ 6. לְנְקוּדוֹתַּיִים הַקִּישׁוּ 7. לְסִימַן שְׁאֵלָה הַקִּישׁוּ 8. לִמֶרְכָאוֹת הַקִּישׁוּ 9. לַחֲזָרָה לַהַקְלָטָה הַקִּישׁוּ 0.\n180 | בְּשָׁעָה\n181 | לִשְׁמִיעַת הַהַקְלָטָה הַקִּישׁוּ 4, לְקַבָּלַת הַמִּסְמָךְ שׁוּב הַקִּישׁוּ 1, לַמִּסְמָךְ הַבָּא הַקִּישׁוּ 2, לַמִּסְמָךְ הַקּוֹדֵם הַקִּישׁוּ 3, לַחֲזָרָה לַתַּפְרִיט הָרָאשִׁי הַקִּישׁוּ 0.\n182 | לִשְׁלִיחָה לְתִּמְלוּל הַמְתִּינוּ. לְהֶמְשֵׁךְ הַקְלָטָה הַקִּישׁוּ 0, לְתַפְרִיט הָעֲרִיכָה הַקִּישׁוּ כּוֹכָבִית.";
let promptsDraft = null;   // נשמר בין מעברי מסך באותו ביקור

function parsePrompts(text) {
  const items = [], errors = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const bar = line.indexOf('|');
    if (bar < 0) { errors.push(`שורה ${i + 1}: חסר "|" בין המספר לטקסט`); return; }
    items.push({ num: line.slice(0, bar).trim(), text: line.slice(bar + 1).trim() });
  });
  return { items, errors };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function renderPromptsTool() {
  app.innerHTML = `${topbar()}<div class="content"><div class="loading">טוען קולות...</div></div>`;
  attachTopbarHandlers();
  let voices = [], current = {};
  try {
    ({ voices, current } = await api('/voices'));
  } catch (e) {
    document.querySelector('.content').innerHTML = `<p class="column-error">שגיאה בטעינת הקולות: ${escapeHtml(e.message)}</p>`;
    return;
  }
  const options = voices.map((v) => `<option value="${v.name}">${v.name} · ${v.ssmlGender === 'MALE' ? 'זכר' : 'נקבה'}</option>`).join('');

  document.querySelector('.content').innerHTML = `
    <h1 class="page-title">הפקת הודעות לקו ימות</h1>
    <p>כל שורה: <b>מספר ההודעה | הטקסט</b>. כל הודעה תיווצר כקובץ <b>NNN/000.wav</b>
       (8000Hz, כמו שימות מקבלת) - מעלים את התיקיות לתוך "הודעות מערכת" בקו.
       הטקסט נשלח לקריין בדיוק כפי שהוא, כולל הניקוד. שורה עם <b>[צליל]</b> תהיה צפצוף קצר.</p>
    <div class="page-frame">
      <div style="display:flex;flex-wrap:wrap;gap:1rem;align-items:end;margin-bottom:0.8rem">
        <label>קול<br><select id="promptVoice" style="padding:0.4em">${options}</select></label>
        <label>מהירות דיבור <span id="rateVal">1.00</span><br>
          <input id="promptRate" type="range" min="0.5" max="1.5" step="0.05" value="1"></label>
      </div>
      <textarea id="promptList" dir="rtl" style="width:100%;min-height:22rem;font-size:1rem;line-height:1.7;padding:0.6em"></textarea>
      <div class="column-toolbar" style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.6rem">
        <button id="promptReset">החזרת הרשימה המקורית</button>
        <button class="primary" id="promptZip">⬇ הפקת כל ההודעות (ZIP)</button>
      </div>
      <div class="job-status" id="promptStatus"></div>
    </div>
    <h2 class="page-title" style="font-size:1.2rem;margin-top:1.5rem">שמיעה לפני הפקה</h2>
    <div id="promptRows"></div>
    <audio id="promptAudio" controls style="display:none;width:100%;margin-top:0.5rem"></audio>`;

  const voiceSel = document.getElementById('promptVoice');
  const rate = document.getElementById('promptRate');
  const list = document.getElementById('promptList');
  const status = document.getElementById('promptStatus');
  const audio = document.getElementById('promptAudio');
  if (current.voiceNormal) voiceSel.value = current.voiceNormal;
  list.value = promptsDraft || DEFAULT_PROMPTS;
  rate.addEventListener('input', () => { document.getElementById('rateVal').textContent = Number(rate.value).toFixed(2); });

  const setStatus = (msg, cls) => { status.textContent = msg; status.className = `job-status ${cls || ''}`; };

  function drawRows() {
    promptsDraft = list.value;
    const { items, errors } = parsePrompts(list.value);
    document.getElementById('promptRows').innerHTML =
      (errors.length ? `<p class="column-error">${errors.map(escapeHtml).join('<br>')}</p>` : '') +
      items.map((it, i) => `
        <div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.4rem 0;border-bottom:1px solid var(--rule)">
          <button data-i="${i}" class="promptPlay" title="שמיעה">▶</button>
          <b style="min-width:2.5em;font-variant-numeric:tabular-nums">${escapeHtml(it.num)}</b>
          <span style="flex:1;min-width:0">${escapeHtml(it.text)}</span>
        </div>`).join('');
    document.querySelectorAll('.promptPlay').forEach((b) => b.addEventListener('click', async () => {
      const it = parsePrompts(list.value).items[Number(b.dataset.i)];
      b.disabled = true;
      try {
        const r = await api('/prompts/preview', { method: 'POST', body: JSON.stringify({ text: it.text, voice: voiceSel.value, rate: rate.value }) });
        audio.src = `data:audio/wav;base64,${r.audioBase64}`;
        audio.style.display = 'block';
        audio.play();
      } catch (e) {
        setStatus(`שמיעת ${it.num} נכשלה: ${e.message}`, 'error');
      } finally { b.disabled = false; }
    }));
  }
  list.addEventListener('input', drawRows);
  drawRows();

  document.getElementById('promptReset').addEventListener('click', () => {
    list.value = DEFAULT_PROMPTS; drawRows(); setStatus('הרשימה המקורית הוחזרה');
  });

  document.getElementById('promptZip').addEventListener('click', async () => {
    const { items, errors } = parsePrompts(list.value);
    if (errors.length) { setStatus(errors[0], 'error'); return; }
    const btn = document.getElementById('promptZip');
    btn.disabled = true;
    setStatus(`מפיק ${items.length} הודעות... זה לוקח כחצי דקה`);
    try {
      const resp = await fetch('/admin/api/prompts/zip', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, voice: voiceSel.value, rate: rate.value }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `שגיאה (${resp.status})`);
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'הודעות_מערכת.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setStatus(`הורד קובץ עם ${items.length} הודעות ✓`, 'done');
    } catch (e) {
      setStatus(`ההפקה נכשלה: ${e.message}`, 'error');
    } finally { btn.disabled = false; }
  });
}

// ==================== ניתוב ====================
function render() {
  const hash = location.hash || '#/';

  fetch('/admin/api/menu-tree', { credentials: 'include' }).then((resp) => {
    if (resp.status === 401) { renderLogin(); return; }

    if (hash === '#/' || hash === '') return renderTreeEditor('root');
    const treeNodeMatch = hash.match(/^#\/tree\/([^/]+)$/);
    if (treeNodeMatch) return renderTreeEditor(treeNodeMatch[1]);
    const masechetMatch = hash.match(/^#\/masechet\/([^/]+)$/);
    if (masechetMatch) return renderMasechet(decodeURIComponent(masechetMatch[1]));
    const dafMatch = hash.match(/^#\/daf\/([^/]+)\/(\d+)\/([ab])$/);
    if (dafMatch) return renderDafEditor(decodeURIComponent(dafMatch[1]), parseInt(dafMatch[2], 10), dafMatch[3]);
    if (hash === '#/voices') return renderVoiceSettings();
    if (hash === '#/prompts') return renderPromptsTool();

    return renderTreeEditor('root');
  });
}

window.addEventListener('hashchange', render);
render();
