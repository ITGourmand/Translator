import { supabaseClient } from "../core/supabase.js";
import { byId } from "../core/dom.js";
import { showToast } from "../core/toast.js";

const SIGN_IN_TAB_CLASS = "flex-1 pb-3 text-center font-semibold text-emerald-600 border-b-2 border-emerald-600 transition";
const INACTIVE_TAB_CLASS = "flex-1 pb-3 text-center font-semibold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition";

let isSignUpMode = false;

function switchMode(signUp) {
    isSignUpMode = signUp;

    const tabSignIn = byId("tab-signin");
    const tabSignUp = byId("tab-signup");
    const usernameContainer = byId("username-container");
    const usernameInput = byId("auth-username");
    const submitBtn = byId("submit-btn");

    tabSignIn.className = isSignUpMode ? INACTIVE_TAB_CLASS : SIGN_IN_TAB_CLASS;
    tabSignUp.className = isSignUpMode ? SIGN_IN_TAB_CLASS : INACTIVE_TAB_CLASS;
    usernameContainer.classList.toggle("hidden", !isSignUpMode);
    usernameInput.required = isSignUpMode;
    submitBtn.textContent = isSignUpMode ? "Create Account" : "Sign In to Platform";
}

async function handleAuth(event) {
    event.preventDefault();

    const email = byId("auth-email").value.trim();
    const password = byId("auth-password").value;
    const submitBtn = byId("submit-btn");

    submitBtn.disabled = true;

    try {
        if (isSignUpMode) {
            const username = byId("auth-username").value.trim();
            if (!username) throw new Error("Username is required.");

            const { error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { username } },
            });

            if (error) throw error;

            showToast("Success!", "Account registered. Check email or try logging in.", "success");
            switchMode(false);
            return;
        }

        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        showToast("Welcome Back", "Redirecting to workspace...", "success");
        setTimeout(() => {
            window.location.href = "index.html";
        }, 1000);
    } catch (error) {
        showToast(isSignUpMode ? "Registration Failed" : "Authentication Failed", error.message, "error");
    } finally {
        submitBtn.disabled = false;
    }
}

async function redirectIfAuthenticated() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) window.location.href = "index.html";
}

function bindEvents() {
    byId("tab-signin").addEventListener("click", () => switchMode(false));
    byId("tab-signup").addEventListener("click", () => switchMode(true));
    byId("auth-form").addEventListener("submit", handleAuth);
}

window.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await redirectIfAuthenticated();
});
