// server/menuTreeRoutes.js
const express = require('express');
const router = express.Router();
const menuTree = require('./menuTree');

router.use(express.json({ limit: '1mb' }));

router.get('/', async (req, res) => {
  const tree = await menuTree.getTree();
  res.json({ tree });
});

router.post('/reset-to-seed', async (req, res) => {
  try {
    const tree = await menuTree.resetToSeed();
    res.json({ ok: true, tree });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

router.post('/node/:parentId/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body;
    const children = await menuTree.reorderChildren(req.params.parentId, orderedIds);
    res.json({ children });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/node/:id/link-content', async (req, res) => {
  try {
    const { contentRef } = req.body;
    const node = await menuTree.setContentRef(req.params.id, contentRef);
    res.json(node);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
