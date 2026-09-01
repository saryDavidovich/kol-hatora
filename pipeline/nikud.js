// pipeline/nikud.js
//
// ניקוד חינמי דרך שירות דיקטה (Dicta) - *** כתובת ומבנה בקשה/תגובה
// מאומתים בפועל *** (הכתובת הישנה הפסיקה להחזיר JSON תקין).

require('dotenv').config();
const axios = require('axios');

const DICTA_NIKUD_URL = process.env.DICTA_NIKUD_URL || 'https://nakdan-2-0.loadbalancer.dicta.org.il/api';

async function addNikud(text, genre = 'rabbinic') {
  const resp = await axios.post(DICTA_NIKUD_URL, {
    data: text,
    task: 'nakdan',
    genre,
    keepmetagim: true,
    keepqq: false,
    matchpartial: false,
    nodageshdefmem: false,
    patachma: false,
    addmorph: false,
  }, {
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    timeout: 60000,
  });

  const data = resp.data;
  if (!Array.isArray(data)) throw new Error('תגובה לא צפויה משירות הניקוד (דיקטה)');

  // options[0] = הניקוד המנוחש הטוב ביותר. "|" מסמן גבול מורפולוגי
  // בתוך המילה - לא מיועד לקריאה, מסירים אותו.
  return data.map((item) => {
    if (item.sep) return item.word;
    const best = (item.options && item.options.length) ? item.options[0] : item.word;
    return best.replace(/\|/g, '');
  }).join('');
}

module.exports = { addNikud };
