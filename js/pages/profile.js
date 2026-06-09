import { ROLE_BADGE_BASE, isAdminRole } from "../core/constants.js";
import { byId, clearElement, createElement, createOption, setText } from "../core/dom.js";
import { fetchCurrentProfile, logout, requireSession, supabaseClient } from "../core/supabase.js";
import { showToast } from "../core/toast.js";
import { isSafeHttpUrl, storageSafeExtension, validateAvatarFile } from "../core/validation.js";

let currentUser = null;

function avatarFallback(username) {
    return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username || "User")}`;
}

function renderRoleControls(profile) {
    const badge = byId("profile-role-badge");
    const redeemBlock = byId("redeem-key-block");
    const createBlock = byId("create-key-block");
    const roleSelect = byId("create-key-role");

    setText(badge, profile.role);
    clearElement(roleSelect);

    if (isAdminRole(profile.role)) {
        badge.className = `${ROLE_BADGE_BASE} mt-1 px-3 py-0.5 bg-brandCyan-100 text-brandCyan-700 border border-brandCyan-200`;
        redeemBlock.classList.add("hidden");
        createBlock.classList.remove("hidden");

        if (profile.role === "superadmin") {
            roleSelect.append(createOption("admin", "Admin"), createOption("reviewer", "Reviewer"));
        } else {
            roleSelect.append(createOption("reviewer", "Reviewer"));
        }
        return;
    }

    badge.className = profile.role === "reviewer"
        ? `${ROLE_BADGE_BASE} mt-1 px-3 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200`
        : `${ROLE_BADGE_BASE} mt-1 px-3 py-0.5 bg-stone-100 text-stone-600 border border-stone-200`;
    redeemBlock.classList.remove("hidden");
    createBlock.classList.add("hidden");
}

async function fetchAndRenderProfile() {
    const profile = await fetchCurrentProfile(currentUser.id);
    if (!profile) {
        showToast("Error", "Could not fetch profile metadata.", "error");
        return;
    }

    setText(byId("profile-username-display"), profile.username);
    byId("settings-username").value = profile.username || "";
    renderRoleControls(profile);

    byId("profile-avatar").src = profile.avatar_url && isSafeHttpUrl(profile.avatar_url)
        ? profile.avatar_url
        : avatarFallback(profile.username);
}

async function generatePromoKey() {
    const roleToGrant = byId("create-key-role").value;
    const container = byId("generated-key-container");
    const keyText = byId("generated-key-text");
    const copyBtn = byId("copy-key-btn");

    showToast("Processing", "Generating secure access token...", "info");
    container.classList.add("hidden");

    const { data: generatedCode, error } = await supabaseClient.rpc("generate_promotion_key", {
        p_role_to_grant: roleToGrant,
    });

    if (error) {
        showToast("Generation Failed", error.message, "error");
        return;
    }

    setText(keyText, generatedCode);
    copyBtn.textContent = "Copy";
    copyBtn.disabled = false;
    container.classList.remove("hidden");
    showToast("Key Created", `Token generated for role: ${roleToGrant}.`, "success");
}

async function copyGeneratedKey() {
    const keyText = byId("generated-key-text");
    const copyBtn = byId("copy-key-btn");
    if (!keyText.textContent) return;

    try {
        await navigator.clipboard.writeText(keyText.textContent);
        showToast("Copied", "Token copied to clipboard.", "success");
        copyBtn.textContent = "Copied!";
        copyBtn.classList.add("text-emerald-600", "font-bold");
    } catch {
        showToast("Copy Error", "Could not copy token automatically.", "error");
    }
}

async function updateProfileInfo(event) {
    event.preventDefault();
    const newUsername = byId("settings-username").value.trim();
    if (!newUsername) return;

    const { error } = await supabaseClient
        .from("profiles")
        .update({ username: newUsername, updated_at: new Date().toISOString() })
        .eq("id", currentUser.id);

    if (error) {
        showToast("Update Failed", error.message, "error");
        return;
    }

    showToast("Profile Updated", "Your username was changed successfully.", "success");
    await fetchAndRenderProfile();
}

async function uploadAvatar() {
    const fileInput = byId("avatar-upload");
    try {
        const file = validateAvatarFile(fileInput.files?.[0]);
        const fileExt = storageSafeExtension(file.name, "png");
        const filePath = `${currentUser.id}/${Date.now()}.${fileExt}`;

        showToast("Uploading", "Uploading your new avatar...", "info");

        const { error: uploadError } = await supabaseClient.storage.from("avatars").upload(filePath, file, { upsert: true });
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabaseClient.storage.from("avatars").getPublicUrl(filePath);
        const { error: patchError } = await supabaseClient.from("profiles").update({ avatar_url: publicUrl }).eq("id", currentUser.id);
        if (patchError) throw patchError;

        showToast("Success", "Avatar updated successfully.", "success");
        await fetchAndRenderProfile();
    } catch (error) {
        showToast("Upload Failed", error.message, "error");
    }
}

async function redeemPromoKey() {
    const tokenInput = byId("promo-key-input").value.trim();
    if (!tokenInput) {
        showToast("Validation Error", "Key field cannot be empty.", "error");
        return;
    }

    const { data: grantedRole, error } = await supabaseClient.rpc("redeem_promotion_key", { token_code: tokenInput });
    if (error) {
        showToast("Activation Failed", error.message, "error");
        return;
    }

    showToast("Role Promoted", `Permissions elevated to: ${grantedRole}.`, "success");
    byId("promo-key-input").value = "";
    await fetchAndRenderProfile();
}

async function deleteAccount() {
    const confirmed = confirm("Are you sure you want to permanently delete your account? This cannot be undone.");
    if (!confirmed) return;

    const { error } = await supabaseClient.functions.invoke("delete-account");
    if (error) {
        showToast("Deletion Failed", error.message, "error");
        return;
    }

    showToast("Account Deleted", "Your account has been permanently removed. Redirecting...", "info");
    setTimeout(() => { window.location.href = "auth.html"; }, 2000);
}

function handleClick(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;

    const { action } = actionElement.dataset;
    if (action === "logout") void logout();
    if (action === "generate-promo-key") void generatePromoKey();
    if (action === "copy-generated-key") void copyGeneratedKey();
    if (action === "redeem-promo-key") void redeemPromoKey();
    if (action === "delete-account") void deleteAccount();
}

async function initProfile() {
    const session = await requireSession();
    if (!session) return;

    currentUser = session.user;
    document.addEventListener("click", handleClick);
    byId("profile-form").addEventListener("submit", updateProfileInfo);
    byId("avatar-upload").addEventListener("change", () => void uploadAvatar());
    await fetchAndRenderProfile();
}

window.addEventListener("DOMContentLoaded", () => {
    void initProfile();
});
