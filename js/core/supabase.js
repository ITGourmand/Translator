import { SUPABASE_KEY, SUPABASE_URL } from "./constants.js";

if (!window.supabase?.createClient) {
    throw new Error("Supabase client library is not loaded.");
}

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export async function requireSession(redirectTo = "auth.html") {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
        window.location.href = redirectTo;
        return null;
    }
    return session;
}

export async function logout(redirectTo = "auth.html") {
    await supabaseClient.auth.signOut();
    window.location.href = redirectTo;
}

/**
 * Fetches the full profile row for the given user ID.
 * Returns null on error — callers must handle the null case.
 */
export async function fetchCurrentProfile(userId) {
    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
    if (error || !profile) return null;
    return profile;
}
