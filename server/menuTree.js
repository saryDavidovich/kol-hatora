// server/menuTree.js
//
// עץ התפריטים - נשמר כ-JSON יחיד ב-CONTENT_ROOT/menu-tree.json. מבנה
// הזרע: שורש > משנה וגמרא > גמרא > 6 סדרים (כרטיסים) > מסכתות
// (כרטיסים, לפי pipeline/shasStructure.js). כל מסכת מקושרת ישירות
// (contentRef) לתוכן שלה - אין צמתים נפרדים לדף/עמוד בעץ עצמו (אלו
// מסך ניהול נפרד, ר' server/adminRoutes.js).

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
const TREE_FILE = path.join(CONTENT_ROOT, 'menu-tree.json');

function makeId() {
  return crypto.randomBytes(5).toString('hex');
}

function seedTree() {
  const SHAS_STRUCTURE = require('../pipeline/shasStructure');

  const node = (name, children = [], extra = {}) => ({
    id: makeId(), name, children, leaf: children.length === 0, contentRef: null, ...extra,
  });

  const sedarim = Object.entries(SHAS_STRUCTURE).map(([sederName, masechtot]) =>
    node(sederName, masechtot.map((m) => node(m, [], { contentRef: m }))));

  return {
    id: 'root',
    name: 'שורש',
    children: [
      node('משנה וגמרא', [
        node('גמרא', sedarim),
      ]),
    ],
  };
}

let cachedTree = null;

async function getTree() {
  if (cachedTree) return cachedTree;
  if (await fs.pathExists(TREE_FILE)) {
    cachedTree = await fs.readJson(TREE_FILE);
  } else {
    cachedTree = seedTree();
    await saveTree(cachedTree);
  }
  return cachedTree;
}

async function saveTree(tree) {
  cachedTree = tree;
  await fs.ensureDir(path.dirname(TREE_FILE));
  await fs.writeJson(TREE_FILE, tree, { spaces: 2 });
  return tree;
}

function findNode(tree, id, parent = null) {
  if (tree.id === id) return { node: tree, parent };
  for (const child of tree.children || []) {
    const found = findNode(child, id, tree);
    if (found) return found;
  }
  return null;
}

async function addNode(parentId, name) {
  const tree = await getTree();
  const found = findNode(tree, parentId);
  if (!found) throw new Error('צומת הורה לא נמצא');
  const newNode = { id: makeId(), name, children: [], leaf: true, contentRef: null };
  found.node.children.push(newNode);
  found.node.leaf = false;
  await saveTree(tree);
  return newNode;
}

async function renameNode(id, name) {
  const tree = await getTree();
  const found = findNode(tree, id);
  if (!found) throw new Error('צומת לא נמצא');
  found.node.name = name;
  await saveTree(tree);
  return found.node;
}

async function deleteNode(id) {
  const tree = await getTree();
  const found = findNode(tree, id);
  if (!found || !found.parent) throw new Error('לא ניתן למחוק צומת זה');
  found.parent.children = found.parent.children.filter((c) => c.id !== id);
  await saveTree(tree);
}

async function reorderChildren(parentId, orderedIds) {
  const tree = await getTree();
  const found = findNode(tree, parentId);
  if (!found) throw new Error('צומת הורה לא נמצא');
  const byId = new Map(found.node.children.map((c) => [c.id, c]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length === found.node.children.length) {
    found.node.children = reordered;
    await saveTree(tree);
  }
  return found.node.children;
}

async function setContentRef(id, contentRef) {
  const tree = await getTree();
  const found = findNode(tree, id);
  if (!found) throw new Error('צומת לא נמצא');
  found.node.contentRef = contentRef || null;
  await saveTree(tree);
  return found.node;
}

/**
 * מחשב את נתיב השלוחה המספרי בימות לפי מיקום הצומת בעץ (סדר האחים
 * בכל רמה) - שינוי סדר משנה את המספור אוטומטית בפעם הבאה שקוראים
 * לפונקציה הזו. צומת השורש עצמו לא נספר.
 */
function getYemotPath(tree, targetId) {
  function walk(node, currentPath) {
    if (node.id === targetId) return currentPath;
    for (let i = 0; i < (node.children || []).length; i++) {
      const found = walk(node.children[i], [...currentPath, i + 1]);
      if (found) return found;
    }
    return null;
  }
  return walk(tree, []);
}

function findNodeByContentRef(tree, contentRef) {
  if (tree.contentRef === contentRef) return tree;
  for (const child of tree.children || []) {
    const found = findNodeByContentRef(child, contentRef);
    if (found) return found;
  }
  return null;
}

function findNodeByYemotPath(tree, pathNumbers) {
  let current = tree;
  for (const num of pathNumbers) {
    const idx = num - 1;
    current = (current.children || [])[idx];
    if (!current) return null;
  }
  return current;
}

/** נתיב שלוחה מלא לעמוד גמרא נתון (מסכת+דף+עמוד) */
async function getMasechetYemotFolder(masechet, daf, amud) {
  const tree = await getTree();
  const node = findNodeByContentRef(tree, masechet);
  if (!node) throw new Error(`מסכת "${masechet}" לא נמצאה מקושרת בעץ`);
  const yemotPath = getYemotPath(tree, node.id);
  if (!yemotPath || !yemotPath.length) throw new Error(`לא הצלחתי לחשב נתיב עבור "${masechet}"`);
  const dafPadded = String(daf).padStart(3, '0');
  return `/${yemotPath.join('/')}/${dafPadded}/${amud}`;
}

module.exports = {
  getTree, saveTree, findNode, addNode, renameNode, deleteNode, reorderChildren, setContentRef,
  getYemotPath, findNodeByContentRef, findNodeByYemotPath, getMasechetYemotFolder,
};
