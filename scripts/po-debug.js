import fs from "fs";

function normalizeMsgid(msgid) {
  return msgid.trim().replace(/\s+/g, " ");
}

function parsePoStringLiteral(line) {
  const match = String(line || "").match(/"((?:\\.|[^"\\])*)"\s*$/);
  if (!match) return "";

  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

function parsePoEntries(text) {
  const sourceLines = String(text || "").split(/\r?\n/);
  const entries = [];

  let msgid = "";
  let msgstr = "";
  let activeField = null;
  let hasActiveEntry = false;

  const pushEntry = () => {
    if (!hasActiveEntry) return;
    entries.push({ msgid, msgstr, isHeader: msgid === "" });
    msgid = "";
    msgstr = "";
    activeField = null;
    hasActiveEntry = false;
  };

  for (const line of sourceLines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      pushEntry();
      continue;
    }

    if (trimmed.startsWith("msgid ")) {
      if (hasActiveEntry) pushEntry();
      hasActiveEntry = true;
      activeField = "msgid";
      msgid = parsePoStringLiteral(trimmed);
      msgstr = "";
      continue;
    }

    if (trimmed.startsWith("msgstr ")) {
      hasActiveEntry = true;
      activeField = "msgstr";
      msgstr = parsePoStringLiteral(trimmed);
      continue;
    }

    if (trimmed.startsWith('"')) {
      if (activeField === "msgid") msgid += parsePoStringLiteral(trimmed);
      if (activeField === "msgstr") msgstr += parsePoStringLiteral(trimmed);
    }
  }

  pushEntry();
  return entries;
}

function parsePoSourceLines(text) {
  return parsePoEntries(text)
    .filter((entry) => !entry.isHeader && entry.msgid.trim() !== "")
    .map((entry, index) => ({ msgid: normalizeMsgid(entry.msgid), sequence_order: index + 1 }));
}

function parsePoTranslations(text) {
  return parsePoEntries(text)
    .filter((entry) => !entry.isHeader && entry.msgid.trim() !== "")
    .map((entry, index) => ({ msgid: normalizeMsgid(entry.msgid), msgstr: entry.msgstr, sequence_order: index + 1 }));
}

function buildFirstNonEmptyTranslationMap(entries) {
  const translations = new Map();
  let skippedDuplicateMsgids = 0;
  let skippedEmpty = 0;

  for (const entry of entries || []) {
    if (!entry.msgstr.trim()) {
      skippedEmpty += 1;
      continue;
    }

    if (translations.has(entry.msgid)) {
      skippedDuplicateMsgids += 1;
      continue;
    }

    translations.set(entry.msgid, entry.msgstr);
  }

  return { translations, skippedDuplicateMsgids, skippedEmpty };
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function printRows(rows, format, max = 100) {
  if (rows.length === 0) {
    console.log("  (aucune entrée)");
    return;
  }

  const slice = rows.slice(0, max);
  for (let i = 0; i < slice.length; i += 1) {
    console.log(format(slice[i], i));
  }
  if (rows.length > max) {
    console.log(`  ... ${rows.length - max} autres entrées omises`);
  }
}

const [sourcePath = "V6.7.po", translationPath = "6.7FR.po"] = process.argv.slice(2);

const sourceText = fs.readFileSync(sourcePath, "utf-8");
const translationText = fs.readFileSync(translationPath, "utf-8");

const sourceEntries = parsePoSourceLines(sourceText);
const translationEntries = parsePoTranslations(translationText);
const translationReport = buildFirstNonEmptyTranslationMap(translationEntries);
const translationMap = translationReport.translations;

const sourceMsgids = sourceEntries.map((entry) => entry.msgid);
const originalSet = new Set(sourceMsgids);
const unmatchedSource = sourceEntries.filter((entry) => !translationMap.has(entry.msgid));
const orphanTranslations = [...translationMap.keys()].filter((msgid) => !originalSet.has(msgid));

printHeader("Fichier source PO pour import DB");
console.log(`Chemin: ${sourcePath}`);
console.log(`Entrées valides à insérer: ${sourceEntries.length}`);
console.log(`(Le parser ignore le header PO et les msgid vides)`);
printRows(sourceEntries, (entry) => `${entry.sequence_order}. ${entry.msgid}`, 200);

printHeader("Fichier PO de traduction FR");
console.log(`Chemin: ${translationPath}`);
console.log(`Entrées détectées: ${translationEntries.length}`);
console.log(`Traductions non importées car msgstr vide: ${translationReport.skippedEmpty}`);
console.log(`Évitées car msgid dupliqué: ${translationReport.skippedDuplicateMsgids}`);
console.log(`Traductions conservées: ${translationMap.size}`);

printHeader("Msgids source sans traduction FR correspondante");
console.log(`Total: ${unmatchedSource.length}`);
printRows(unmatchedSource, (entry) => `${entry.sequence_order}. ${entry.msgid}`, 100);

printHeader("Msgids FR présents mais absents du PO source");
console.log(`Total: ${orphanTranslations.length}`);
printRows(orphanTranslations, (msgid) => msgid, 100);

printHeader("Résumé final");
console.log(`Source importées: ${sourceEntries.length}`);
console.log(`Traductions FR utilisables: ${translationMap.size}`);
console.log(`Source sans traduction FR: ${unmatchedSource.length}`);
console.log(`Traductions FR orphelines: ${orphanTranslations.length}`);
