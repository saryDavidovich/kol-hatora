// pipeline/uploadToYemot.js
//
// *** מאומת בפועל ***: UploadFile דורש multipart/form-data עם שדה
// "Upload" + path, קידומת "ivr2:" חובה בנתיב. Login: GET Login עם
// username/password מחזיר { token }.

require('dotenv').config();
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const FormData = require('form-data');

const YEMOT_USERNAME = process.env.YEMOT_USERNAME;
const YEMOT_PASSWORD = process.env.YEMOT_PASSWORD;
const YEMOT_BASE = 'https://www.call2all.co.il/ym/api';

async function login() {
  const resp = await axios.get(`${YEMOT_BASE}/Login`, {
    params: { username: YEMOT_USERNAME, password: YEMOT_PASSWORD },
    timeout: 15000,
  });
  if (!resp.data || !resp.data.token) throw new Error('כניסה לימות נכשלה - בדקו שם משתמש/סיסמה');
  return resp.data.token;
}

async function uploadFile(token, localFilePath, remotePath) {
  const form = new FormData();
  form.append('token', token);
  form.append('path', `ivr2:${remotePath}`);
  form.append('Upload', fs.createReadStream(localFilePath));
  await axios.post(`${YEMOT_BASE}/UploadFile`, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 60000,
  });
}

async function uploadTextFile(token, contents, remotePath) {
  await axios.post(`${YEMOT_BASE}/UploadTextFile`, null, {
    params: { token, what: `ivr2:${remotePath}`, contents },
    timeout: 30000,
  });
}

/**
 * מעלה תיקיית עמוד שלמה (כל קבצי ה-wav שבה + ext.ini) לתיקיית יעד
 * בימות. @param remoteFolder נתיב יעד (למשל '/2/1/1/002/a')
 */
async function uploadAmud({ localDir, remoteFolder, extIniContent }) {
  const token = await login();

  const files = await fs.readdir(localDir);
  const wavFiles = files.filter((f) => f.endsWith('.wav'));

  for (const wav of wavFiles) {
    await uploadFile(token, path.join(localDir, wav), `${remoteFolder}/${wav}`);
  }

  if (extIniContent) {
    await uploadTextFile(token, extIniContent, `${remoteFolder}/ext.ini`);
  }

  return { uploadedFiles: wavFiles };
}

module.exports = { login, uploadFile, uploadTextFile, uploadAmud };
