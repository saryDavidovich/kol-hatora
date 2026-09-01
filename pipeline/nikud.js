// pipeline/nikud.js
//
// ניקוד חינמי דרך שירות דיקטה (Dicta) - API ציבורי.

require('dotenv').config();
const axios = require('axios');

const DICTA_NIKUD_URL = process.env.DICTA_NIKUD_URL || 'https://nakdan-api-lab.loadbalancer.dicta.org.il/addnikud';

async function addNikud(text, genre = 'rabbinic') {
  const resp = await axios.post(DICTA_NIKUD_URL, {
    task: 'nakdan',
    genre,
    data: text,
    addmorph: false,
    keepqq: false,
    keepmetagim: true,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  const data = resp.data;
  if (!Array.isArray(data)) throw new Error('תגובה לא צפויה משירות הניקוד');

  return data.map((word) => {
    if (word.options && word.options.length) return word.options[0].w || word.word;
    return word.word || '';
  }).join('');
}

module.exports = { addNikud };
