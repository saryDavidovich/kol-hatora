// pipeline/uploadToYemot.js
//
// מעלה את קבצי האודיו + קובץ ה-ext.ini שנוצרו לכל עמוד, לשלוחה המתאימה
// בימות המשיח, באמצעות ה-API הרשמי לניהול מערכות ("API - גישת מפתחים
// למערכות", לא לבלבל עם "מודול API" ה-IVR-facing שמשמש את server/).
//
// *** חשוב - נקודה הדורשת אימות לפני שימוש בפרודקשן ***
// לא אימתתי במלואו את הנתיבים/פרמטרים המדויקים של ה-endpoints הבאים
// (Login, קבלת token, ואופן העלאת קובץ) מול התיעוד המלא בכתובת:
//   https://f2.freeivr.co.il/topic/55/api-גישת-מפתחים-למערכות
// לפני הרצה על תוכן אמיתי - יש לפתוח את התיעוד המלא, לוודא את שמות
// הפרמטרים המדויקים (login/token/upload), ולהתאים את הפונקציות למטה.
// המבנה הכללי (login -> token -> קריאות מאומתות עם token) כן מאומת.

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const YEMOT_API_BASE = process.env.YEMOT_API_BASE || 'https://www.call2all.co.il/ym/api';
const YEMOT_USERNAME = process.env.YEMOT_USERNAME;
const YEMOT_PASSWORD = process.env.YEMOT_PASSWORD;

let cachedToken = null;

async function login() {
  if (cachedToken) return cachedToken;
  if (!YEMOT_USERNAME || !YEMOT_PASSWORD) {
    throw new Error('חסרים YEMOT_USERNAME / YEMOT_PASSWORD ב-.env');
  }
  // TODO לאימות סופי: שם הפעולה/הנתיב המדויק לפי תיעוד ה-API הרשמי
  const resp = await axios.get(`${YEMOT_API_BASE}/Login`, {
    params: { username: YEMOT_USERNAME, password: YEMOT_PASSWORD },
  });
  if (!resp.data || !resp.data.token) {
    throw new Error(`התחברות לימות נכשלה: ${JSON.stringify(resp.data)}`);
  }
  cachedToken = resp.data.token;
  return cachedToken;
}

/**
 * מעלה קובץ בודד לנתיב שלוחה מסוים.
 * @param remoteFolder  נתיב השלוחה בימות, למשל '/20/bava-kama/002/a'
 * @param remoteFileName שם הקובץ ביעד, כולל סיומת ('gemara.wav', 'ext.ini')
 * @param localFilePath נתיב הקובץ המקומי להעלאה
 */
async function uploadFile(remoteFolder, remoteFileName, localFilePath) {
  const token = await login();
  const fileBuffer = await fs.readFile(localFilePath);

  // TODO לאימות סופי: שם הפעולה/הפרמטרים המדויקים להעלאת קובץ
  // (ייתכן שנדרש multipart/form-data ולא raw buffer - יש לוודא מול התיעוד)
  await axios.post(`${YEMOT_API_BASE}/UploadFile`, fileBuffer, {
    params: { token, path: `${remoteFolder}/${remoteFileName}` },
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

/** מעלה עמוד שלם: שלושת קבצי האודיו + timeline.json + ext.ini */
async function uploadAmud({ localDir, remoteFolder, extIniContent }) {
  const files = await fs.readdir(localDir);
  for (const fileName of files) {
    const localPath = path.join(localDir, fileName);
    const stat = await fs.stat(localPath);
    if (stat.isDirectory()) continue;
    await uploadFile(remoteFolder, fileName, localPath);
  }

  // כתיבת ext.ini זמנית והעלאתו
  const tmpExtPath = path.join(localDir, '.ext.ini.tmp');
  await fs.writeFile(tmpExtPath, extIniContent, 'utf-8');
  await uploadFile(remoteFolder, 'ext.ini', tmpExtPath);
  await fs.remove(tmpExtPath);
}

module.exports = { login, uploadFile, uploadAmud };
