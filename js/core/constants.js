export const SUPABASE_URL = "https://xxwlrshgdupnpejurhqi.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4d2xyc2hnZHVwbnBlanVyaHFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMTU1NDAsImV4cCI6MjA5NTc5MTU0MH0.MrIpDTGc9H-YbhVXdrHAA50UbWqMI2SULb_3XjeKTJU";

export const ALLOWED_LANGUAGES = Object.freeze(["EN", "FR", "ES", "IT", "DE", "RU", "CH", "JP"]);

export const LANGUAGE_LABELS = Object.freeze({
    EN: "EN",
    FR: "FR",
    ES: "ES",
    IT: "IT",
    DE: "DE",
    RU: "RU",
    CH: "CH",
    JP: "JP",
});

export const ROLES = Object.freeze({
    TRANSLATOR: "translator",
    REVIEWER: "reviewer",
    ADMIN: "admin",
    SUPERADMIN: "superadmin",
});

// Base classes for role badges — add padding/spacing at the call site.
export const ROLE_BADGE_BASE = "rounded-full text-xs font-semibold uppercase tracking-wider";

export const MAX_PO_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function isAdminRole(role) {
    return role === ROLES.ADMIN || role === ROLES.SUPERADMIN;
}

export function isReviewerRole(role) {
    return role === ROLES.REVIEWER || isAdminRole(role);
}
