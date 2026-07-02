import { supabaseClient } from "../core/supabase.js";
import { byId } from "../core/dom.js";
import { showToast } from "../core/toast.js";

async function handleForgotPassword(event) {
    event.preventDefault();

    const email = byId("forgot-email").value.trim();
    const submitBtn = byId("submit-btn");

    submitBtn.disabled = true;

    try {
        // Détection : si on est sur localhost, on garde l'origine locale, sinon on force l'adresse GitHub Pages
        const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        
        const redirectToUrl = isLocal 
            ? `${window.location.origin}/reset-password.html` 
            : "https://itgourmand.github.io/Translator/reset-password.html";

        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: redirectToUrl,
        });

        if (error) throw error;

        showToast("Email envoyé !", "Vérifiez votre boîte de réception pour réinitialiser votre mot de passe.", "success");
    } catch (error) {
        showToast("Erreur de demande", error.message, "error");
    } finally {
        submitBtn.disabled = false;
    }
}

window.addEventListener("DOMContentLoaded", () => {
    byId("forgot-form").addEventListener("submit", handleForgotPassword);
});