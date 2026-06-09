import { ALLOWED_LANGUAGES, LANGUAGE_LABELS, MAX_AVATAR_BYTES, MAX_PO_FILE_BYTES } from "./constants.js";

const RECORD_ID_PATTERN = /^[0-9a-f-]{1,64}$/i;

export function normalizeLanguage(value, fallback = "FR") {
    const language = String(value || "").trim().toUpperCase();
    return ALLOWED_LANGUAGES.includes(language) ? language : fallback;
}

export function firstLanguageExcept(language, fallback = "FR") {
    const excludedLanguage = normalizeLanguage(language, "");
    return ALLOWED_LANGUAGES.find((item) => item !== excludedLanguage) || fallback;
}

export function assertAllowedLanguage(value) {
    const language = normalizeLanguage(value, "");
    if (!language) throw new Error("Unsupported language selection.");
    return language;
}

export function isValidRecordId(value) {
    return RECORD_ID_PATTERN.test(String(value || "").trim());
}

export function requireRecordId(value, label = "Record id") {
    const id = String(value || "").trim();
    if (!isValidRecordId(id)) throw new Error(`${label} is invalid.`);
    return id;
}

export function normalizePositiveInteger(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function validatePoFile(file) {
    if (!file) throw new Error("Please provide a .po file.");
    if (!/\.po$/i.test(file.name || "")) throw new Error("Only .po files are accepted.");
    if (file.size > MAX_PO_FILE_BYTES) throw new Error("The .po file is too large.");
    return file;
}

export function validateAvatarFile(file) {
    if (!file) throw new Error("Please provide an image file.");
    if (!String(file.type || "").startsWith("image/")) throw new Error("Only image files are accepted.");
    if (file.size > MAX_AVATAR_BYTES) throw new Error("The image file is too large.");
    return file;
}

export function sanitizeFileBaseName(value, fallback = "project") {
    const sanitized = String(value || "")
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
    return sanitized || fallback;
}

export function storageSafeExtension(fileName, fallback = "po") {
    const extension = String(fileName || "").split(".").pop()?.toLowerCase() || fallback;
    return /^[a-z0-9]{1,12}$/.test(extension) ? extension : fallback;
}

export function configureLanguageSelect(select, options = {}) {
    if (!select) return;
    const { excludedLanguage, selectedLanguage } = options;
    const excluded = normalizeLanguage(excludedLanguage, "");
    const selected = normalizeLanguage(selectedLanguage, firstLanguageExcept(excluded));

    Array.from(select.options).forEach((option) => {
        option.disabled = option.value === excluded;
        option.hidden = option.value === excluded;
        option.style.display = option.value === excluded ? "none" : "";
    });

    select.value = selected === excluded ? firstLanguageExcept(excluded) : selected;
}

export function languageLabel(language) {
    const normalized = normalizeLanguage(language, "");
    return LANGUAGE_LABELS[normalized] || normalized || "";
}

export function isSafeHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}
