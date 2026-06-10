function parsePoStringLiteral(line) {
    const match = String(line || "").match(/"((?:\\.|[^"\\])*)"\s*$/);
    if (!match) return "";

    try {
        return JSON.parse(`"${match[1]}"`);
    } catch {
        return match[1]
            .replace(/\\"/g, "\"")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "\r")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");
    }
}

function escapePoString(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\r/g, "")
        .replace(/\n/g, "\\n");
}

export function parsePoEntries(text) {
    const sourceLines = String(text || "").split(/\r?\n/);
    const entries = [];

    let msgid = "";
    let msgstr = "";
    let activeField = null;
    let hasActiveEntry = false;

    const pushEntry = () => {
        if (!hasActiveEntry) return;
        entries.push({
            msgid,
            msgstr,
            isHeader: msgid === "",
        });
        msgid = "";
        msgstr = "";
        activeField = null;
        hasActiveEntry = false;
    };

    sourceLines.forEach((line) => {
        const trimmed = line.trim();

        if (trimmed === "") {
            pushEntry();
            return;
        }

        if (trimmed.startsWith("msgid ")) {
            if (hasActiveEntry) pushEntry();
            hasActiveEntry = true;
            activeField = "msgid";
            msgid = parsePoStringLiteral(trimmed);
            msgstr = "";
            return;
        }

        if (trimmed.startsWith("msgstr ")) {
            hasActiveEntry = true;
            activeField = "msgstr";
            msgstr = parsePoStringLiteral(trimmed);
            return;
        }

        if (trimmed.startsWith("\"")) {
            if (activeField === "msgid") msgid += parsePoStringLiteral(trimmed);
            if (activeField === "msgstr") msgstr += parsePoStringLiteral(trimmed);
        }
    });

    pushEntry();
    return entries;
}

export function parsePoSourceLines(text) {
    return parsePoEntries(text)
        .filter((entry) => !entry.isHeader && entry.msgid.trim() !== "")
        .map((entry, index) => ({
            msgid: entry.msgid,
            sequence_order: index + 1,
        }));
}

export function parsePoTranslations(text) {
    return parsePoEntries(text)
        .filter((entry) => !entry.isHeader && entry.msgid.trim() !== "")
        .map((entry, index) => ({
            msgid: entry.msgid,
            msgstr: entry.msgstr,
            sequence_order: index + 1,
        }));
}

export function buildFirstNonEmptyTranslationMap(entries) {
    const translations = new Map();
    let skippedDuplicateMsgids = 0;
    let skippedEmpty = 0;

    for (const entry of entries || []) {
        const msgid = String(entry?.msgid || "");
        const msgstr = String(entry?.msgstr || "");
        if (!msgstr.trim()) {
            skippedEmpty++;
            continue;
        }

        if (translations.has(msgid)) {
            skippedDuplicateMsgids++;
            continue;
        }

        translations.set(msgid, msgstr);
    }

    return { translations, skippedDuplicateMsgids, skippedEmpty };
}

export function replacePoMsgstrs(sourceText, translations) {
    const sourceLines = String(sourceText || "").split(/\r?\n/);
    const resultLines = [];

    let currentMsgid = "";
    let inMsgid = false;
    let inMsgstr = false;
    let currentMsgstrLines = [];
    let translationIndex = 0;

    const flushMsgstr = () => {
        if (!inMsgstr) return;

        const isHeader = currentMsgid === "";
        let approvedTranslation = null;

        if (!isHeader) {
            if (Array.isArray(translations)) {
                approvedTranslation = translations[translationIndex];
                translationIndex++;
            } else if (translations instanceof Map) {
                approvedTranslation = translations.get(currentMsgid);
            } else if (translations && typeof translations === "object") {
                approvedTranslation = translations[currentMsgid];
            }
        }

        if (approvedTranslation !== undefined && approvedTranslation !== null && approvedTranslation !== "") {
            resultLines.push(`msgstr "${escapePoString(approvedTranslation)}"`);
        } else {
            resultLines.push(...currentMsgstrLines);
        }

        currentMsgstrLines = [];
        inMsgstr = false;
    };

    for (let i = 0; i < sourceLines.length; i++) {
        const line = sourceLines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith("msgid ")) {
            flushMsgstr();
            inMsgid = true;
            currentMsgid = parsePoStringLiteral(trimmed);
            resultLines.push(line);
        } else if (trimmed.startsWith("msgstr")) {
            inMsgid = false;
            inMsgstr = true;
            currentMsgstrLines.push(line);
        } else if (trimmed.startsWith('"')) {
            if (inMsgid) {
                currentMsgid += parsePoStringLiteral(trimmed);
                resultLines.push(line);
            } else if (inMsgstr) {
                currentMsgstrLines.push(line);
            } else {
                resultLines.push(line);
            }
        } else {
            flushMsgstr();
            resultLines.push(line);
        }
    }

    flushMsgstr();

    return resultLines.join("\n");
}
