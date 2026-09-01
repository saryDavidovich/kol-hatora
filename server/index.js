// server/index.js
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const proto = require('./yemotProtocol');
const contentIndex = require('./contentIndex');
const menuTree = require('./menuTree');
const db = require('./db');
const adminAuth = require('./adminAuth');
const adminRoutes = require('./adminRoutes');

const app = express();
app.use(cookieParser());

app.use((req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  if (req.method === 'POST' && req.path.startsWith('/api/')) {
    express.urlencoded({ extended: true })(req, res, () => {
      console.log('  body:', JSON.stringify(req.body));
      next();
    });
  } else {
    next();
  }
});

/**
 * מסלול יחיד המטפל בכל שלבי הבחירה בעזרת שרשור read.
 * *** ניווט דינמי בעץ (server/menuTree.js) בעומק בלתי מוגבל *** -
 * n1, n2, n3... מצטברים ככל שנבחרת רמה נוספת. ברגע שמגיעים לעלה
 * מקושר לתוכן (contentRef) - ממשיכים לבחירת דף/עמוד (הקשה, לא תפריט).
 */
const MAX_TREE_DEPTH = 20;

app.all('/api/ivr/main', async (req, res) => {
  const params = { ...req.query, ...req.body };
  const phone = params.ApiPhone || params.Phone || 'unknown';

  try {
    const tree = await menuTree.getTree();

    let node = tree;
    let level = 1;
    for (; level <= MAX_TREE_DEPTH; level++) {
      const key = `n${level}`;
      if (params[key] === undefined) break;
      const idx = parseInt(params[key], 10) - 1;
      const child = (node.children || [])[idx];
      if (!child) {
        const menu = (node.children || []).map((c, i) => `${i + 1}. ${c.name}`).join(', ');
        return res.send(proto.read([proto.textItem(`בחירה לא תקינה. ${menu}`)], key, { maxDigits: 2 }));
      }
      node = child;
    }

    if (!node.leaf && node.children && node.children.length) {
      const menu = node.children.map((c, i) => `${i + 1}. ${c.name}`).join(', ');
      const prompt = level === 1 ? `ברוכים הבאים. ${menu}` : menu;
      return res.send(proto.read([proto.textItem(prompt)], `n${level}`, { maxDigits: 2 }));
    }

    if (!node.contentRef) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem(`${node.name} - התוכן בבנייה, בקרוב אי"ה`)]),
        proto.goToFolder('/'),
      ));
    }

    const masechetId = node.contentRef;

    if (!params.daf) {
      return res.send(proto.read([proto.textItem('הקישו את מספר הדף המבוקש')], 'daf', { maxDigits: 3 }));
    }
    const daf = parseInt(params.daf, 10);
    if (!daf || daf < 2) {
      return res.send(proto.read([proto.textItem('מספר דף לא תקין. הקישו שוב')], 'daf', { maxDigits: 3 }));
    }

    if (!params.amud) {
      return res.send(proto.read([proto.textItem('לעמוד א הקישו 1, לעמוד ב הקישו 2')], 'amud', { maxDigits: 1 }));
    }
    const amud = params.amud === '2' ? 'b' : 'a';

    if (!contentIndex.amudExists(masechetId, daf, amud)) {
      return res.send(proto.chain(
        proto.idListMessage([proto.textItem('העמוד המבוקש אינו קיים במערכת כרגע')]),
        proto.goToFolder('/'),
      ));
    }

    db.setCallState(phone, { masechet: masechetId, daf, amud, track: 'gemara', speed: 1.0 });
    const savedOffset = db.getPosition(phone, masechetId, daf, amud, 'gemara');
    const targetFolder = await menuTree.getMasechetYemotFolder(masechetId, daf, amud);

    return res.send(proto.goToFolderAndPlay(targetFolder, 'gemara', savedOffset));
  } catch (err) {
    console.error(err);
    return res.send(proto.idListMessage([proto.textItem('אירעה שגיאה זמנית, נסו שוב')]));
  }
});

app.use('/api/player', require('./playerApi'));

// --- ממשק ניהול ---
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));
app.post('/admin/api/login', express.json(), adminAuth.handleLogin);
app.post('/admin/api/logout', adminAuth.handleLogout);
app.use('/admin/api/menu-tree', adminAuth.requireAdminAuth, require('./menuTreeRoutes'));
app.use('/admin/api', adminAuth.requireAdminAuth, adminRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`שרת ימות-הש"ס מאזין על 0.0.0.0:${PORT}`);
});
