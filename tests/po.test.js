import test from "node:test";
import assert from "node:assert/strict";
import { parsePoSourceLines, parsePoTranslations, replacePoMsgstrs } from "../js/core/po.js";

test("parsePoSourceLines reads simple and multiline msgids without the header", () => {
    const text = [
        'msgid ""',
        'msgstr "Project-Id-Version: test\\n"',
        "",
        'msgid "hello "',
        '"world"',
        'msgstr ""',
        "",
        'msgid "bye"',
        'msgstr "au revoir"',
    ].join("\n");

    assert.deepEqual(parsePoSourceLines(text), [
        { msgid: "hello world", sequence_order: 1 },
        { msgid: "bye", sequence_order: 2 },
    ]);
});

test("parsePoTranslations keeps msgstr order for imports", () => {
    const text = [
        'msgid ""',
        'msgstr ""',
        "",
        'msgid "hello"',
        'msgstr "bonjour"',
        "",
        'msgid "bye"',
        'msgstr ""',
    ].join("\n");

    assert.deepEqual(parsePoTranslations(text), [
        { msgid: "hello", msgstr: "bonjour", sequence_order: 1 },
        { msgid: "bye", msgstr: "", sequence_order: 2 },
    ]);
});

test("replacePoMsgstrs preserves the header and exports escaped translations", () => {
    const source = [
        'msgid ""',
        'msgstr "Project-Id-Version: test\\n"',
        "",
        'msgid "hello"',
        'msgstr ""',
        "",
        'msgid "quote"',
        'msgstr "old"',
    ].join("\n");

    const exported = replacePoMsgstrs(source, ["bonjour", 'il dit "oui"\n']);

    assert.equal(
        exported,
        [
            'msgid ""',
            'msgstr "Project-Id-Version: test\\n"',
            "",
            'msgid "hello"',
            'msgstr "bonjour"',
            "",
            'msgid "quote"',
            'msgstr "il dit \\"oui\\"\\n"',
        ].join("\n"),
    );
});
