import test from "node:test";
import assert from "node:assert/strict";
import {
    assertAllowedLanguage,
    firstLanguageExcept,
    normalizeLanguage,
    requireRecordId,
    sanitizeFileBaseName,
    storageSafeExtension,
} from "../js/core/validation.js";

test("language helpers normalize and reject unsupported values", () => {
    assert.equal(normalizeLanguage("fr"), "FR");
    assert.equal(firstLanguageExcept("FR"), "EN");
    assert.equal(assertAllowedLanguage("jp"), "JP");
    assert.throws(() => assertAllowedLanguage("xx"), /Unsupported language/);
});

test("record ids and file names are normalized conservatively", () => {
    assert.equal(requireRecordId("123"), "123");
    assert.equal(requireRecordId("1a2b-3c"), "1a2b-3c");
    assert.throws(() => requireRecordId("../1"), /invalid/);
    assert.equal(sanitizeFileBaseName("My Cool Project!"), "my_cool_project");
    assert.equal(storageSafeExtension("file.po"), "po");
    assert.equal(storageSafeExtension("archive.tar.gz"), "gz");
    assert.equal(storageSafeExtension("dangerous_file.php/../../exec"), "po"); // fallback
});
