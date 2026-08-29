// server/yemotProtocol.js
//
// בונה מחרוזות תגובה בפרוטוקול המדויק שמצפה לו "מודול API" של ימות המשיח.
// מקור: https://f2.freeivr.co.il/topic/56 (מודול API - תקשור עם מחשבים)
//
// עקרונות (מאומת מול התיעוד הרשמי):
// - תגובת השרת היא טקסט פשוט (לא JSON, לא HTML).
// - כמה פעולות אפשר לשרשר עם & : id_list_message=...&go_to_folder=...
// - id_list_message מכיל רצף פריטים מופרדים בנקודה, כל פריט הוא "סוג-תוכן":
//     t-טקסט         (הקראת TTS)
//     f-שם_קובץ       (השמעת קובץ wav מהשלוחה, או f-/נתיב/מלא)
//     m-1001         (הודעת מערכת לפי מספר)
// - go_to_folder=/5/8              -> מעבר לשלוחה אחרת
// - go_to_folder_and_play=/1/5,005,1001
//     פרמטרים: שלוחת יעד, שם קובץ (או נתיב מלא), נקודת עצירה באלפיות שנייה
//     *זו הפעולה המרכזית שמאפשרת "המשך מאיפה שעצרת" בכל מפרש בנפרד*
// - read=<מה להשמיע>=<פרמטר>,<use_saved>,<max_digits>,<min_digits>,...
//     מאפשר "דיאלוג" - מבקש הקשה נוספת מהמשתמש ושולח את זה חזרה לשרת
//     בבקשה הבאה, כדי לבנות תפריט מדורג (נושא -> ספר -> דף -> עמוד)

/** בריחה מתווים בעייתיים בטקסט TTS (נקודה וקו מפריד אסורים לפי התיעוד) */
function escapeTtsText(text) {
  return String(text).replace(/[.\-]/g, ' ');
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

function goToFolder(folderPath) {
  return `go_to_folder=${folderPath}`;
}

/**
 * הפעולה המרכזית: מעביר את המאזין לשלוחת playfile מסוימת, ומתחיל להשמיע
 * קובץ ספציפי מתוכה, החל מנקודת עצירה מדויקת (במילישניות).
 *
 * @param folderPath   שלוחת היעד, למשל '/shas/bava-kama/daf-002/a'
 * @param fileNameOrFullPath   שם קובץ בתוך אותה שלוחה, או נתיב מלא
 * @param offsetMs     נקודת ההתחלה באלפיות שנייה (0 = מההתחלה)
 */
function goToFolderAndPlay(folderPath, fileNameOrFullPath, offsetMs = 0) {
  return `go_to_folder_and_play=${folderPath},${fileNameOrFullPath},${Math.max(0, Math.round(offsetMs))}`;
}

/**
 * בונה בקשת read - משמיע הודעה ומבקש הקשה, שתחזור לשרת בבקשה הבאה
 * תחת השם שצוין ב-paramName.
 *
 * תחביר מאומת מול דוגמת קוד עובדת בפועל (פורום מפתחים ימות):
 *   read=<תוכן להשמעה>=<param>,<confirm>,<max>,<min>,<timeout>,<extra>
 * confirm='no' חשוב מאוד - אם 'yes', ימות משמיע חזרה את מה שהוקש
 * ומבקש אישור ("הקש 1 לאישור, 2 לתיקון") לפני שממשיך - זו לרוב חוויה
 * מיותרת לתפריטי ניווט פשוטים (בחירת דף/עמוד וכו').
 *
 * @param promptItems  מערך פריטי id_list_message להשמעה (t-/f-/m-)
 * @param paramName    שם הפרמטר שבו תישמר ההקשה (יחזור בבקשה הבאה מהשרת)
 * @param opts         { maxDigits, minDigits, timeoutSec, confirm }
 */
function read(promptItems, paramName, opts = {}) {
  const { maxDigits = 2, minDigits = 1, timeoutSec = 15, confirm = 'no' } = opts;
  return `read=${promptItems.join('.')}=${paramName},${confirm},${maxDigits},${minDigits},${timeoutSec},No`;
}

/** שרשור מספר פעולות לתגובה אחת */
function chain(...actions) {
  return actions.filter(Boolean).join('&');
}

module.exports = {
  textItem, fileItem, idListMessage, goToFolder, goToFolderAndPlay, read, chain,
};
