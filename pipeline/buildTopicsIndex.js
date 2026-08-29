// pipeline/buildTopicsIndex.js
//
// יוצר את data/shas-content/index.json שממנו server/index.js קורא
// את רשימת הנושאים והספרים לתפריט הראשי. יש לערוך את המערך למטה
// כך שישקף את התוכן שבאמת סרקתם והעליתם.

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(__dirname, '..', 'data', 'shas-content');

const topics = [
  {
    id: 'shas',
    name: 'תלמוד בבלי',
    books: [
      // הערה: המזהה (id) הוא השם העברי עצמו, בדיוק כמו שתיקיות התוכן
      // נשמרות בפועל (data/shas-content/shas/<שם עברי>/...) וכמו שמפתחות
      // הטבלה ב-pipeline/masechtotDapim.js כתובות. אם המזהה כאן לא זהה
      // בדיוק לתיקייה בפועל - המערכת "תאבד" תוכן שכבר נבנה.
      { id: 'ברכות', name: 'ברכות' },
      { id: 'בבא קמא', name: 'בבא קמא' },
      { id: 'בבא מציעא', name: 'בבא מציעא' },
      { id: 'בבא בתרא', name: 'בבא בתרא' },
      // ... להשלים לפי הסדר שברצונכם להנגיש קודם
    ],
  },
  // ניתן להוסיף נושא נוסף, למשל:
  // { id: 'tanach', name: 'תנ"ך', books: [ { id: 'בראשית', name: 'בראשית' }, ... ] },
];

async function main() {
  await fs.ensureDir(CONTENT_ROOT);
  await fs.writeJson(path.join(CONTENT_ROOT, 'index.json'), { topics }, { spaces: 2 });
  console.log(`נכתב ${path.join(CONTENT_ROOT, 'index.json')}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { topics };
