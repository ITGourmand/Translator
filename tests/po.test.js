import test from "node:test";
import assert from "node:assert/strict";
import {
    buildFirstNonEmptyTranslationMap,
    parsePoSourceLines,
    parsePoTranslations,
    replacePoMsgstrs,
} from "../js/core/po.js";

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

test("parsePoTranslations preserves duplicate msgid entries in order", () => {
    const text = [
        'msgid "same"',
        'msgstr "first"',
        "",
        'msgid "same"',
        'msgstr "second"',
    ].join("\n");

    assert.deepEqual(parsePoTranslations(text), [
        { msgid: "same", msgstr: "first", sequence_order: 1 },
        { msgid: "same", msgstr: "second", sequence_order: 2 },
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

test("replacePoMsgstrs non-destructive merge with dictionary", () => {
    const source = [
        '# translator comment',
        '#. automatic comment',
        '#: reference',
        '#, flags',
        '#| msgid "old_msgid"',
        'msgid "hello"',
        'msgstr "hello_old"',
        '',
        '# another comment',
        'msgid "world"',
        'msgstr "world_old"',
    ].join("\n");

    // "world" has no approved translation, so it should keep "world_old"
    // "hello" has "bonjour" approved, so it should update to "bonjour"
    const translations = {
        "hello": "bonjour"
    };

    const exported = replacePoMsgstrs(source, translations);

    assert.equal(
        exported,
        [
            '# translator comment',
            '#. automatic comment',
            '#: reference',
            '#, flags',
            '#| msgid "old_msgid"',
            'msgid "hello"',
            'msgstr "bonjour"',
            '',
            '# another comment',
            'msgid "world"',
            'msgstr "world_old"',
        ].join("\n")
    );
});

test("replacePoMsgstrs exports duplicate msgids by ordered occurrence", () => {
    const source = [
        'msgid "same"',
        'msgstr "old first"',
        '',
        'msgid "same"',
        'msgstr "old second"',
    ].join("\n");

    const exported = replacePoMsgstrs(source, ["first approved", "second approved"]);

    assert.equal(
        exported,
        [
            'msgid "same"',
            'msgstr "first approved"',
            '',
            'msgid "same"',
            'msgstr "second approved"',
        ].join("\n"),
    );
});

test("buildFirstNonEmptyTranslationMap keeps the first non-empty msgstr per msgid", () => {
    const entries = parsePoTranslations([
        'msgid "same"',
        'msgstr "first"',
        '',
        'msgid "same"',
        'msgstr "second"',
        '',
        'msgid "empty"',
        'msgstr ""',
        '',
        'msgid "other"',
        'msgstr "value"',
    ].join("\n"));

    const result = buildFirstNonEmptyTranslationMap(entries);

    assert.deepEqual([...result.translations.entries()], [
        ["same", "first"],
        ["other", "value"],
    ]);
    assert.equal(result.skippedDuplicateMsgids, 1);
    assert.equal(result.skippedEmpty, 1);
});
