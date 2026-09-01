// server/wikisourceImportRoutes.js
//
// ייבוא ספר שלם מוויקיטקסט לתוך תתי-הסעיפים הקיימים בעץ (כל תת-סעיף
// מקבל אוטומטית תוכן ראשי + כל המפרשים שנבחרו). תומך בשני מצבים:
//   - mode='torah': תבניות מאומתות מובנות (תורה, עם חלוקת פרקים אוטומטית)
//   - mode='custom': תבניות חופשיות שהמנהל מזין בעצמו (כל ספר אחר,
//     כמו שולחן ערוך - לא מאומת, יש לבדוק תוצאה אחת לפני ריצה על ספר שלם)

const express = require('express');
const router = express.Router();

const menuTree = require('./menuTree');
const nodeContent = require('./nodeContent');
const jobs = require('./jobs');
const { DEFAULT_TEMPLATES, fetchSingle, fetchTorahParasha } = require('../pipeline/scrapeGeneric');
const PARASHA_PERAKIM = require('../pipeline/parashaPerakim');

router.use(express.json({ limit: '1mb' }));

// --- רשימת הפרקים הידועים (לתפריט "תורה" בממשק) ---
router.get('/torah-sfarim', (req, res) => {
  res.json({ sfarim: Object.keys(PARASHA_PERAKIM), commentators: Object.keys(DEFAULT_TEMPLATES.torah.commentators) });
});

// --- בדיקת תבנית בודדת (לפני ריצה על ספר שלם - "custom" mode) ---
router.post('/test-template', async (req, res) => {
  const { template, sefer, item } = req.body;
  if (!template || !sefer || !item) return res.status(400).json({ error: 'חסרים פרטים' });
  try {
    const result = await fetchSingle(template, sefer, item);
    res.json({ title: result.title, sample: result.plainText.slice(0, 500) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- ייבוא בפועל - לכל תתי-הסעיפים של הצומת ---
router.post('/:nodeId/import', async (req, res) => {
  const { nodeId } = req.params;
  const { mode, sefer, mainTemplate, commentators } = req.body;
  // commentators: [{ name, template }] (עבור custom) או [{ name }] בלבד (עבור torah - התבנית כבר ידועה)

  const tree = await menuTree.getTree();
  const found = menuTree.findNode(tree, nodeId);
  if (!found) return res.status(404).json({ error: 'צומת לא נמצא' });
  const children = found.node.children || [];
  if (!children.length) return res.status(400).json({ error: 'לצומת הזה אין תתי-סעיפים לייבא אליהם' });

  const jobId = jobs.runAsJob(async (progress) => {
    const results = [];
    let done = 0;

    for (const child of children) {
      progress(Math.round((done / children.length) * 100), `מייבא ${child.name} (${done + 1}/${children.length})...`);
      const itemResult = { name: child.name, nodeId: child.id, ok: true, errors: [] };

      try {
        // --- תוכן ראשי ---
        let mainText;
        if (mode === 'torah') {
          const r = await fetchTorahParasha(DEFAULT_TEMPLATES.torah.main, sefer, child.name);
          mainText = r.plainText;
        } else {
          const r = await fetchSingle(mainTemplate, sefer, child.name);
          mainText = r.plainText;
        }
        await nodeContent.updateMain(child.id, { text: mainText });
      } catch (err) {
        itemResult.ok = false;
        itemResult.errors.push(`תוכן ראשי: ${err.message}`);
      }

      // --- מפרשים ---
      for (const com of commentators || []) {
        try {
          let comText;
          if (mode === 'torah') {
            const template = DEFAULT_TEMPLATES.torah.commentators[com.name];
            if (!template) throw new Error(`מפרש "${com.name}" לא ברשימת התורה הידועה`);
            const r = await fetchTorahParasha(template, sefer, child.name);
            comText = r.plainText;
          } else {
            const r = await fetchSingle(com.template, sefer, child.name);
            comText = r.plainText;
          }

          // מוודאים שיש תת-תוכן בשם הזה בצומת (יוצרים אם חסר)
          const existing = await nodeContent.getContent(child.id);
          let sub = existing.subContents.find((s) => s.name === com.name);
          if (!sub) sub = await nodeContent.addSub(child.id, com.name);
          await nodeContent.updateSub(child.id, sub.id, { text: comText });
        } catch (err) {
          itemResult.ok = false;
          itemResult.errors.push(`${com.name}: ${err.message}`);
        }
      }

      results.push(itemResult);
      done++;
    }

    const successCount = results.filter((r) => r.ok).length;
    progress(100, `הושלם - ${successCount}/${results.length} הצליחו במלואם`);
    return { results };
  });

  res.json({ jobId });
});

module.exports = router;
