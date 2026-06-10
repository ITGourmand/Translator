#!/usr/bin/env -S deno run --allow-read
import {
  parsePoSourceLines,
  parsePoTranslations,
  buildFirstNonEmptyTranslationMap,
} from "../supabase/functions/_shared/po-parser.ts";

const [sourcePath = "V6.7.po", translationPath = "6.7FR.po"] = Deno.args;

function printHeader(title: string) {
  console.log(`\n=== ${title} ===`);
}

function printRows<T>(title: string, rows: T[], format: (row: T, index: number) => string, max = 100) {
  printHeader(`${title} (${rows.length})`);
  if (rows.length === 0) {
    console.log("  (aucune entrée)");
    return;
  }

  const slice = rows.slice(0, max);
  for (let i = 0; i < slice.length; i++) {
    console.log(format(slice[i], i));
  }
  if (rows.length > max) {
    console.log(`  ... ${rows.length - max} autres entrées omises`);
  }
}

const [sourceText, translationText] = await Promise.all([
  Deno.readTextFile(sourcePath),
  Deno.readTextFile(translationPath),
]);

const sourceEntries = parsePoSourceLines(sourceText);
const translationEntries = parsePoTranslations(translationText);
const translationMapResult = buildFirstNonEmptyTranslationMap(translationEntries);
const translationMap = translationMapResult.translations;

const sourceMsgids = sourceEntries.map((entry) => entry.msgid);
const originalSet = new Set(sourceMsgids);
const unmatchedSource = sourceEntries.filter((entry) => !translationMap.has(entry.msgid));
const orphanTranslations = [...translationMap.keys()].filter((msgid) => !originalSet.has(msgid));

printHeader("Fichier source PO pour import DB");
console.log(`Chemin: ${sourcePath}`);
console.log(`Entrées valides à insérer: ${sourceEntries.length}`);
console.log(`(Le parser ignore le header PO et les msgid vides)`);

printRows(
  "Lignes qui seraient insérées en base",
  sourceEntries,
  (entry) => `${entry.sequence_order}. ${entry.msgid}`,
  200,
);

printHeader("Fichier PO de traduction FR");
console.log(`Chemin: ${translationPath}`);
console.log(`Entrées détectées: ${translationEntries.length}`);
console.log(`Traductions non importées car msgstr vide: ${translationMapResult.skippedEmpty}`);
console.log(`Évitées car msgid dupliqué: ${translationMapResult.skippedDuplicateMsgids}`);
console.log(`Traductions conservées: ${translationMap.size}`);

printRows(
  "Msgids source sans traduction FR correspondante",
  unmatchedSource,
  (entry) => `${entry.sequence_order}. ${entry.msgid}`,
  100,
);

printRows(
  "Msgids FR présents mais absents du PO source",
  orphanTranslations,
  (msgid) => msgid,
  100,
);

printHeader("Résumé final");
console.log(`Source importées: ${sourceEntries.length}`);
console.log(`Traductions FR utilisables: ${translationMap.size}`);
console.log(`Source sans traduction FR: ${unmatchedSource.length}`);
console.log(`Traductions FR orphelines: ${orphanTranslations.length}`);
