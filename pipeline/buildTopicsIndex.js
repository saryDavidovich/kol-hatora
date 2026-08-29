// pipeline/buildTopicsIndex.js
//
// כלי CLI ידני - כותב את data/shas-content/index.json מתוך הרשימה
// המשותפת ב-pipeline/topicsData.js. שימושי לבדיקה מקומית או לכתיבה
// ידנית חד-פעמית, אבל שימו לב: **השרת עצמו כבר כותב את הקובץ הזה
// אוטומטית בהפעלה** אם הוא חסר (ראה server/contentIndex.js) - כך
// שבדרך כלל אין צורך להריץ את הסקריפט הזה ידנית בכלל.

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');
const { topics } = require('./topicsData');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

async function main() {
  await fs.ensureDir(CONTENT_ROOT);
  await fs.writeJson(path.join(CONTENT_ROOT, 'index.json'), { topics }, { spaces: 2 });
  console.log(`נכתב ${path.join(CONTENT_ROOT, 'index.json')}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { topics };

