/**
 * Shared PO file parser for Supabase Edge Functions.
 * Mirrors the logic in js/core/po.js — keep both in sync.
 */

/** Normalize msgid by collapsing whitespace and trimming. */
function normalizeMsgid(msgid: string): string {
    return msgid
        .trim() // Remove leading/trailing whitespace
        .replace(/\s+/g, ' '); // Collapse multiple spaces into one
}

function parsePoStringLiteral(line: string): string {
    const match = String(line ?? "").match(/"((?:\\.|[^"\\])*)"\s*$/);
    if (!match) return "";
    try {
        // JSON.parse handles all standard escape sequences correctly.
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

interface PoEntry {
    msgid: string;
    msgstr: string;
    isHeader: boolean;
}

function parsePoEntries(text: string): PoEntry[] {
    const sourceLines = String(text ?? "").split(/\r?\n/);
    const entries: PoEntry[] = [];

    let msgid = "";
    let msgstr = "";
    let activeField: "msgid" | "msgstr" | null = null;
    let hasActiveEntry = false;

    const pushEntry = (): void => {
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

export interface PoSourceLine {
    msgid: string;
    sequence_order: number;
}

/** Returns non-header entries with their 1-based sequence order. */
export function parsePoSourceLines(text: string): PoSourceLine[] {
    return parsePoEntries(text)
        .filter((entry) => !entry.isHeader && entry.msgid.trim() !== "")
        .map((entry, index) => ({ msgid: normalizeMsgid(entry.msgid), sequence_order: index + 1 }));
}

export interface PoTranslation {
    msgid: string;
    msgstr: string;
    sequence_order: number;
}

/** Returns non-header entries with both msgid and msgstr. */
export function parsePoTranslations(text: string): PoTranslation[] {
    return parsePoEntries(text)
        .filter((entry) => !entry.isHeader && entry.msgid.trim() !== "")
        .map((entry, index) => ({
            msgid: normalizeMsgid(entry.msgid),
            msgstr: entry.msgstr,
            sequence_order: index + 1,
        }));
}

export interface FirstTranslationMapResult {
    translations: Map<string, string>;
    skippedDuplicateMsgids: number;
    skippedEmpty: number;
}

export function buildFirstNonEmptyTranslationMap(entries: PoTranslation[]): FirstTranslationMapResult {
    const translations = new Map<string, string>();
    let skippedDuplicateMsgids = 0;
    let skippedEmpty = 0;

    for (const entry of entries) {
        if (!entry.msgstr.trim()) {
            skippedEmpty++;
            continue;
        }

        if (translations.has(entry.msgid)) {
            skippedDuplicateMsgids++;
            continue;
        }

        translations.set(entry.msgid, entry.msgstr);
    }

    return { translations, skippedDuplicateMsgids, skippedEmpty };
}
