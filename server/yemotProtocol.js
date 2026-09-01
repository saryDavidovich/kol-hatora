// server/yemotProtocol.js
//
// בניית תגובות בפרוטוקול ימות המשיח. *** תחביר read מאומת בפועל ***:
//   read=<תוכן>=<param>,no,<max>,<min>,<timeout>,No
// (בלי Digits/yes בסוף - זה גרם לתת-תפריט אישור לא רצוי בבדיקות בפועל)

/** בריחה מתווים בעייתיים בטקסט TTS (נקודה, מקף, גרש/גרשיים - אסורים/גורמים לכשל) */
function escapeTtsText(text) {
  return String(text).replace(/[.\-"'\u05F3\u05F4]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function textItem(text) {
  return `t-${escapeTtsText(text)}`;
}

function fileItem(fileNameOrPath) {
  return `f-${fileNameOrPath}`;
}

function idListMessage(items) {
  return `id_list_message=${items.join('.')}`;
}

function read(items, paramName, opts = {}) {
  const maxDigits = opts.maxDigits || 1;
  const minDigits = opts.minDigits || 1;
  const timeout = opts.timeout || 15;
  return `read=${items.join('.')}=${paramName},no,${maxDigits},${minDigits},${timeout},No`;
}

function goToFolder(folder) {
  return `go_to_folder=${folder}`;
}

function goToFolderAndPlay(folder, fileName, offsetMs) {
  const off = offsetMs || 0;
  return `go_to_folder_and_play=${folder},${fileName},${off}`;
}

function chain(...responses) {
  return responses.join('&');
}

module.exports = {
  escapeTtsText, textItem, fileItem, idListMessage, read, goToFolder, goToFolderAndPlay, chain,
};
