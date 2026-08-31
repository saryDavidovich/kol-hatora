// server/menuTree.js
//
// עץ התפריטים המרכזי של המערכת - מחליף את topicsData.js הישן (שהיה
// שטוח: נושא -> ספר בלבד). כל צומת יכול להכיל תתי-צמתים בעומק בלתי
// מוגבל. צמתים "עלים" (leaf: true) יכולים להיות מקושרים לתוכן קיים
// (contentRef = מזהה מסכת, כמו שכבר בנוי במערכת) - כשמגיעים אליהם
// בשיחה, ממשיכים לתוך תהליך בחירת דף/עמוד הרגיל שכבר קיים.
//
// נשמר כקובץ JSON יחיד ב-CONTENT_ROOT/menu-tree.json - נטען פעם אחת
// לזיכרון ונשמר בחזרה בכל שינוי. נזרע אוטומטית עם המבנה הראשוני
// שהתקבל מהמשתמש אם הקובץ עוד לא קיים (בדיוק כמו pipeline/topicsData.js
// עשה לרשימת הנושאים הישנה).

const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');
const TREE_FILE = path.join(CONTENT_ROOT, 'menu-tree.json');

function makeId() {
  return crypto.randomBytes(5).toString('hex');
}

/** מבנה זרע ראשוני - בדיוק כפי שהתקבל מהמשתמש (תנ"ך מפורט, השאר ריק לעת עתה) */
function seedTree() {
  const torahParshiot = {
    בראשית: ['בראשית', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא', 'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי'],
    שמות: ['שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא', 'ויקהל', 'פקודי'],
    ויקרא: ['ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקותי'],
    במדבר: ['במדבר', 'נשא', 'בהעלותך', 'שלח', 'קורח', 'חוקת', 'בלק', 'פנחס', 'מטות', 'מסעי'],
    דברים: ['דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים', 'כי תצא', 'כי תבא', 'נצבים', 'וילך', 'האזינו', 'וזאת הברכה'],
  };
  const neviim = [
    'יהושע', 'שופטים', 'שמואל א', 'שמואל ב', 'מלכים א', 'מלכים ב', 'ישעיהו', 'ירמיהו', 'יחזקאל',
    'עמוס', 'עובדיה', 'יונה', 'מיכה', 'נחום', 'חבקוק', 'צפניה', 'חגי', 'זכריה', 'מלאכי',
  ];

  const node = (name, children = [], extra = {}) => ({
    id: makeId(), name, children, leaf: children.length === 0, contentRef: null, ...extra,
  });

  const torahBooks = Object.entries(torahParshiot).map(([bookName, parshiot]) =>
    node(bookName, parshiot.map((p) => node(p))));

  return {
    id: 'root',
    name: 'שורש',
    children: [
      node('תנ"ך', [
        node('תורה', torahBooks),
        node('נביאים', neviim.map((n) => node(n))),
        node('כתובים', []), // "אפרט בהמשך"
      ]),
      node('משנה וגמרא', []), // "פירוט בהמשך"
      node('הלכה', []),
      node('מוסר וחסידות', []),
      node('תפילות', []),
    ],
  };
}

let cachedTree = null;

/**
 * מיגרציה חד-פעמית: מוודא שכל מסכת שכבר יש לה תוכן בפועל (נבנתה
 * לפחות עמוד אחד) מופיעה כתת-סעיף תחת "משנה וגמרא" בעץ, ומקושרת
 * אליה. לא נוגעת בכלום אחר - רק מוסיפה מסכתות שעדיין לא מקושרות
 * לאף צומת קיים בעץ (בודקת לפי contentRef בכל העץ).
 */
function migrateMasechtotIntoTree(tree) {
  const contentIndex = require('./contentIndex');
  const MASECHTOT_DAPIM = require('../pipeline/masechtotDapim');

  const gemaraNode = (tree.children || []).find((c) => c.name === 'משנה וגמרא');
  if (!gemaraNode) return tree; // אין צומת כזה - לא עושים כלום

  // אוספים את כל ה-contentRef הקיימים בעץ, כדי לא לשכפל
  const linkedRefs = new Set();
  (function walk(n) {
    if (n.contentRef) linkedRefs.add(n.contentRef);
    (n.children || []).forEach(walk);
  })(tree);

  for (const masechet of Object.keys(MASECHTOT_DAPIM)) {
    if (linkedRefs.has(masechet)) continue;
    if (!contentIndex.amudExists(masechet, 2, 'a')) continue; // רק אם באמת נבנה תוכן
    gemaraNode.children.push({
      id: makeId(), name: masechet, children: [], leaf: true, contentRef: masechet,
    });
    gemaraNode.leaf = false;
  }

  return tree;
}

async function getTree() {
  if (cachedTree) return cachedTree;
  if (await fs.pathExists(TREE_FILE)) {
    cachedTree = await fs.readJson(TREE_FILE);
  } else {
    cachedTree = seedTree();
  }
  const before = JSON.stringify(cachedTree);
  cachedTree = migrateMasechtotIntoTree(cachedTree);
  if (JSON.stringify(cachedTree) !== before) {
    await saveTree(cachedTree); // רק כותבים בחזרה אם המיגרציה באמת שינתה משהו
  }
  return cachedTree;
}

async function saveTree(tree) {
  cachedTree = tree;
  await fs.ensureDir(path.dirname(TREE_FILE));
  await fs.writeJson(TREE_FILE, tree, { spaces: 2 });
  return tree;
}

/** מוצא צומת לפי id, ומחזיר גם את ההורה שלו (לצורך מחיקה/הזזה) */
function findNode(tree, id, parent = null) {
  if (tree.id === id) return { node: tree, parent };
  for (const child of tree.children || []) {
    const found = findNode(child, id, tree);
    if (found) return found;
  }
  return null;
}

/** מוצא צומת לפי נתיב מזהים (למשל ['id1','id2']) - לשימוש בזמן שיחה */
function findNodeByPath(tree, pathIds) {
  let current = tree;
  for (const id of pathIds) {
    current = (current.children || []).find((c) => c.id === id);
    if (!current) return null;
  }
  return current;
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

/** מזיז צומת מעלה/מטה בין אחיו (direction: -1 למעלה, +1 למטה) */
async function moveNode(id, direction) {
  const tree = await getTree();
  const found = findNode(tree, id);
  if (!found || !found.parent) throw new Error('לא ניתן להזיז צומת זה');
  const siblings = found.parent.children;
  const idx = siblings.findIndex((c) => c.id === id);
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= siblings.length) return; // כבר בקצה, אין מה לעשות
  [siblings[idx], siblings[newIdx]] = [siblings[newIdx], siblings[idx]];
  await saveTree(tree);
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
 * מחשב את "נתיב השלוחה" המספרי בימות עבור צומת נתון - בדיוק לפי
 * המיקום שלו בעץ (סדר האחים ברמה כל רמה). למשל אם "משנה וגמרא" הוא
 * הכרטיס השני בשורש, וברכות היא הכרטיס הראשון בתוכו - הנתיב יהיה [2,1]
 * (כלומר שלוחה /2/1 בימות). שינוי סדר (הזזה) משנה את המספור אוטומטית
 * בפעם הבאה שקוראים לפונקציה הזו - אין מספור "קבוע" שנשמר בנפרד.
 * צומת השורש עצמו לא נספר (הוא לא מוצג ככרטיס באתר).
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

/** מוצא צומת-עלה לפי contentRef (למשל שם מסכת) - לשימוש כשצריך לחשב נתיב מתוך מזהה תוכן בלבד */
function findNodeByContentRef(tree, contentRef) {
  if (tree.contentRef === contentRef) return tree;
  for (const child of tree.children || []) {
    const found = findNodeByContentRef(child, contentRef);
    if (found) return found;
  }
  return null;
}

/**
 * פונקציית עזר מרכזית: בהינתן מזהה מסכת (contentRef), דף ועמוד - מחזירה
 * את נתיב השלוחה המלא בימות (מספרי, לפי מיקום בעץ + דף/עמוד בתוכו).
 * זו הפונקציה היחידה שאמורה לדעת "איך בונים נתיב" - כל שאר הקוד קורא
 * לה, כדי שלא יהיה מקום אחד ששוכח לעדכן כשמשנים משהו במבנה המספור.
 */
async function getMasechetYemotFolder(masechet, daf, amud) {
  const tree = await getTree();
  const node = findNodeByContentRef(tree, masechet);
  if (!node) {
    throw new Error(`מסכת "${masechet}" לא נמצאה מקושרת בשום מקום בעץ התפריטים`);
  }
  const yemotPath = getYemotPath(tree, node.id);
  if (!yemotPath || !yemotPath.length) {
    throw new Error(`לא הצלחתי לחשב נתיב שלוחה עבור "${masechet}" - ייתכן שהצומת לא נמצא בעץ בפועל`);
  }
  const dafPadded = String(daf).padStart(3, '0');
  return `/${yemotPath.join('/')}/${dafPadded}/${amud}`;
}

async function setNodeType(id, type) {
  const tree = await getTree();
  const found = findNode(tree, id);
  if (!found) throw new Error('צומת לא נמצא');
  found.node.type = type; // 'folder' | 'file'
  await saveTree(tree);
  return found.node;
}

/** מסדר מחדש את סדר הילדים של הורה נתון, לפי מערך מזהים בסדר הרצוי (לגרירה חופשית) */
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

module.exports = {
  getTree, saveTree, findNode, findNodeByPath, addNode, renameNode, deleteNode, moveNode, setContentRef,
  getYemotPath, findNodeByContentRef, getMasechetYemotFolder, setNodeType, reorderChildren,
};
