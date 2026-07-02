import { supabaseClient } from "../core/supabase.js";
import { byId } from "../core/dom.js";
import { showToast } from "../core/toast.js";

async function handleResetPassword(event) {
    event.preventDefault();

    const newPassword = byId("new-password").value;
    const submitBtn = byId("submit-btn");

    submitBtn.disabled = true;

    try {
        const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        showToast("Succès !", "Votre mot de passe a bien été mis à jour. Redirection...", "success");
        
        setTimeout(() => {
            window.location.href = "auth.html";
        }, 2000);
    } catch (error) {
        showToast("Erreur de mise à jour", error.message, "error");
    } finally {
        submitBtn.disabled = false;
    }
}

window.addEventListener("DOMContentLoaded", () => {
    byId("reset-form").addEventListener("submit", handleResetPassword);
});