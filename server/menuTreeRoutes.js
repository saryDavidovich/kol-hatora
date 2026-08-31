// server/menuTreeRoutes.js
//
// API לממשק הניהול לעריכת עץ התפריטים: הוספת צומת, שינוי שם, מחיקה,
// הזזה מעלה/מטה (קובעת את הסדר בתוך ימות), וקישור צומת-עלה לתוכן
// קיים (מסכת שכבר נבנתה). כל שינוי נשמר מיד ומשפיע על ימות בשיחה
// הבאה - אין צורך ב"פרסום" נפרד.

const express = require('express');
const router = express.Router();

const menuTree = require('./menuTree');
const MASECHTOT_DAPIM = require('../pipeline/masechtotDapim');

router.use(express.json({ limit: '1mb' }));

router.get('/', async (req, res) => {
  const tree = await menuTree.getTree();
  res.json({ tree, availableMasechtot: Object.keys(MASECHTOT_DAPIM) });
});

router.post('/node/:parentId/add', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'חסר שם' });
    const node = await menuTree.addNode(req.params.parentId, name.trim());
    res.json(node);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/node/:id/rename', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'חסר שם' });
    const node = await menuTree.renameNode(req.params.id, name.trim());
    res.json(node);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/node/:id/delete', async (req, res) => {
  try {
    await menuTree.deleteNode(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/node/:id/move', async (req, res) => {
  try {
    const { direction } = req.body; // -1 או 1
    await menuTree.moveNode(req.params.id, direction);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/node/:id/link-content', async (req, res) => {
  try {
    const { contentRef } = req.body; // מזהה מסכת (שם עברי), או null לביטול קישור
    const node = await menuTree.setContentRef(req.params.id, contentRef);
    res.json(node);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
