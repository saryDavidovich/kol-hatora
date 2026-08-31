// server/nodeContent.js
//
// תוכן גנרי לכל צומת-"קובץ" בעץ התפריטים (server/menuTree.js) - לא
// קשור למבנה הקשיח של דף/עמוד גמרא. כל צומת-קובץ יכול להכיל:
//   - תוכן ראשי (mainContent): טקסט + קישור מקור אופציונלי
//   - תתי-תוכן בלתי מוגבלים (subContents): כל אחד עם שם, טקסט,
//     וקישור מקור משלו - למשל "ביאור", "תרגום", "הערות" וכו'
// נשמר כקובץ JSON יחיד לכל צומת, ב-CONTENT_ROOT/node-content/<nodeId>.json

const path = require('path');
const fs = require('fs-extra');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
const NODE_CONTENT_DIR = path.join(CONTENT_ROOT, 'node-content');

function contentPath(nodeId) {
  return path.join(NODE_CONTENT_DIR, `${nodeId}.json`);
}

async function getContent(nodeId) {
  const p = contentPath(nodeId);
  if (!(await fs.pathExists(p))) {
    return { mainContent: { name: 'תוכן ראשי', text: '', sourceUrl: '' }, subContents: [] };
  }
  return fs.readJson(p);
}

async function saveContent(nodeId, content) {
  await fs.ensureDir(NODE_CONTENT_DIR);
  await fs.writeJson(contentPath(nodeId), content, { spaces: 2 });
  return content;
}

async function updateMain(nodeId, { text, sourceUrl, name }) {
  const content = await getContent(nodeId);
  if (text !== undefined) content.mainContent.text = text;
  if (sourceUrl !== undefined) content.mainContent.sourceUrl = sourceUrl;
  if (name !== undefined) content.mainContent.name = name;
  return saveContent(nodeId, content);
}

async function addSub(nodeId, name) {
  const content = await getContent(nodeId);
  const sub = { id: Date.now().toString(36), name, text: '', sourceUrl: '' };
  content.subContents.push(sub);
  await saveContent(nodeId, content);
  return sub;
}

async function updateSub(nodeId, subId, { text, sourceUrl, name }) {
  const content = await getContent(nodeId);
  const sub = content.subContents.find((s) => s.id === subId);
  if (!sub) throw new Error('תת-תוכן לא נמצא');
  if (text !== undefined) sub.text = text;
  if (sourceUrl !== undefined) sub.sourceUrl = sourceUrl;
  if (name !== undefined) sub.name = name;
  await saveContent(nodeId, content);
  return sub;
}

async function deleteSub(nodeId, subId) {
  const content = await getContent(nodeId);
  content.subContents = content.subContents.filter((s) => s.id !== subId);
  await saveContent(nodeId, content);
}

module.exports = { getContent, saveContent, updateMain, addSub, updateSub, deleteSub };
