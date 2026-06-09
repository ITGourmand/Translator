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

export function replacePoMsgstrs(sourceText, orderedTranslations) {
    const sourceLines = String(sourceText || "").split(/\r?\n/);
    const resultLines = [];
    let translationIndex = 0;
    let index = 0;

    while (index < sourceLines.length) {
        const line = sourceLines[index];

        if (!line.startsWith("msgid ")) {
            resultLines.push(line);
            index += 1;
            continue;
        }

        const msgidLines = [line];
        let rawMsgid = parsePoStringLiteral(line);
        index += 1;

        while (index < sourceLines.length && sourceLines[index].startsWith("\"")) {
            msgidLines.push(sourceLines[index]);
            rawMsgid += parsePoStringLiteral(sourceLines[index]);
            index += 1;
        }

        resultLines.push(...msgidLines);
        const isHeader = rawMsgid === "";

        while (index < sourceLines.length && !sourceLines[index].startsWith("msgstr")) {
            resultLines.push(sourceLines[index]);
            index += 1;
        }

        if (index >= sourceLines.length) continue;

        if (isHeader) {
            resultLines.push(sourceLines[index]);
            index += 1;
            while (index < sourceLines.length && sourceLines[index].startsWith("\"")) {
                resultLines.push(sourceLines[index]);
                index += 1;
            }
            continue;
        }

        while (index < sourceLines.length && sourceLines[index].startsWith("msgstr")) {
            index += 1;
            while (index < sourceLines.length && sourceLines[index].startsWith("\"")) {
                index += 1;
            }
        }

        const approvedText = orderedTranslations[translationIndex] ?? "";
        translationIndex += 1;
        resultLines.push(`msgstr "${escapePoString(approvedText)}"`);
    }

    return resultLines.join("\n");
}
