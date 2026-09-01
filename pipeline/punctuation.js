// pipeline/punctuation.js
require('dotenv').config();
const axios = require('axios');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

async function addPunctuation(text) {
  if (!ANTHROPIC_API_KEY) throw new Error('לא הוגדר ANTHROPIC_API_KEY - פיסוק אוטומטי לא זמין');

  const resp = await axios.post('https://api.anthropic.com/v1/messages', {
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `הוסף פיסוק (נקודות, פסיקים, סימני שאלה) לטקסט התלמודי הבא, בלי לשנות אף מילה. החזר רק את הטקסט המפוסק, בלי הקדמות:\n\n${text}`,
    }],
  }, {
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    timeout: 60000,
  });

  const content = resp.data.content;
  return content.map((c) => c.text || '').join('').trim();
}

module.exports = { addPunctuation };
