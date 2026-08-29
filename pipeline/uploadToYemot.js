// pipeline/uploadToYemot.js
//
// מעלה את קבצי האודיו + קובץ ה-ext.ini שנוצרו לכל עמוד, לשלוחה המתאימה
// בימות המשיח, באמצעות ה-API הרשמי לניהול מערכות.
//
// *** תחביר מאומת בפועל *** מול דוגמאות קוד עובדות שנמצאו בפורום
// מפתחי ימות (f2.freeivr.co.il, topics 55/7618/1079):
//
// UploadFile (קבצים בינאריים, למשל WAV):
//   POST https://www.call2all.co.il/ym/api/UploadFile?token=<TOKEN>
//   גוף הבקשה: multipart/form-data עם שני שדות:
//     Upload = תוכן הקובץ הגולמי
//     path   = "ivr2:<נתיב מלא כולל שם קובץ>"  (שימו לב לקידומת ivr2:)
//
// UploadTextFile (קבצי טקסט, למשל ext.ini):
//   POST https://www.call2all.co.il/ym/api/UploadTextFile
//   פרמטרים (query string): token, what="ivr2:<נתיב מלא>", contents=<טקסט>
//
// login עדיין לא אומת באותה רמת ודאות (לא נמצאה דוגמה מלאה של תגובת
// ה-Login), אבל הצורה במשתמש/סיסמה -> טוקן ב-JSON היא הדפוס הסביר
// ביותר ותואמת קטעי קוד חלקיים שכן נמצאו.

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');

const YEMOT_API_BASE = process.env.YEMOT_API_BASE || 'https://www.call2all.co.il/ym/api';
const YEMOT_USERNAME = process.env.YEMOT_USERNAME;
const YEMOT_PASSWORD = process.env.YEMOT_PASSWORD;

let cachedToken = null;

function extractYemotError(err) {
  if (err.response && err.response.data) {
    const d = err.response.data;
    return typeof d === 'string' ? d.slice(0, 300) : JSON.stringify(d).slice(0, 300);
  }
  return err.message;
}

async function login() {
  if (cachedToken) return cachedToken;
  if (!YEMOT_USERNAME || !YEMOT_PASSWORD) {
    throw new Error('חסרים YEMOT_USERNAME / YEMOT_PASSWORD ב-.env');
  }
  try {
    const resp = await axios.get(`${YEMOT_API_BASE}/Login`, {
      params: { username: YEMOT_USERNAME, password: YEMOT_PASSWORD },
    });
    if (!resp.data || !resp.data.token) {
      throw new Error(`התחברות לימות נכשלה: ${JSON.stringify(resp.data)}`);
    }
    cachedToken = resp.data.token;
    return cachedToken;
  } catch (err) {
    throw new Error(`Login לימות נכשל: ${extractYemotError(err)}`);
  }
}

/**
 * מעלה קובץ בינארי (כמו WAV) - multipart/form-data עם שדה 'Upload'.
 * @param remoteFolder  נתיב השלוחה בימות, למשל '/20/ברכות/002/a' (בלי ivr2:)
 * @param remoteFileName שם הקובץ ביעד, כולל סיומת ('gemara.wav')
 * @param localFilePath נתיב הקובץ המקומי להעלאה
 */
async function uploadFile(remoteFolder, remoteFileName, localFilePath) {
  const token = await login();
  const fileBuffer = await fs.readFile(localFilePath);
  const fullPath = `ivr2:${remoteFolder}/${remoteFileName}`;

  const form = new FormData();
  form.append('Upload', fileBuffer, { filename: remoteFileName });
  form.append('path', fullPath);

  try {
    await axios.post(`${YEMOT_API_BASE}/UploadFile`, form, {
      params: { token },
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (err) {
    throw new Error(`UploadFile נכשל (${fullPath}): ${extractYemotError(err)}`);
  }
}

/**
 * מעלה קובץ טקסט (כמו ext.ini) - query params פשוטים, בלי multipart.
 * @param remoteFolder  נתיב השלוחה בימות (בלי ivr2:)
 * @param remoteFileName שם הקובץ ביעד (כולל סיומת, למשל 'ext.ini')
 * @param contents       תוכן הטקסט עצמו
 */
async function uploadTextFile(remoteFolder, remoteFileName, contents) {
  const token = await login();
  const fullPath = `ivr2:${remoteFolder}/${remoteFileName}`;

  try {
    await axios.post(`${YEMOT_API_BASE}/UploadTextFile`, null, {
      params: { token, what: fullPath, contents },
    });
  } catch (err) {
    throw new Error(`UploadTextFile נכשל (${fullPath}): ${extractYemotError(err)}`);
  }
}

/** מעלה עמוד שלם: כל קבצי האודיו (בינארי) + ext.ini (טקסט) */
async function uploadAmud({ localDir, remoteFolder, extIniContent }) {
  const files = await fs.readdir(localDir);
  for (const fileName of files) {
    const localPath = path.join(localDir, fileName);
    const stat = await fs.stat(localPath);
    if (stat.isDirectory()) continue;
    if (fileName.endsWith('.json')) continue; // meta.json/timeline - לא צריך להעלות לימות
    await uploadFile(remoteFolder, fileName, localPath);
  }
  await uploadTextFile(remoteFolder, 'ext.ini', extIniContent);
}

module.exports = { login, uploadFile, uploadTextFile, uploadAmud };
