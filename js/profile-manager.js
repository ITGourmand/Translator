let currentUser = null;

async function checkSession() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = "auth.html";
        return;
    }
    currentUser = session.user;
    await fetchAndRenderProfile();
}

async function fetchAndRenderProfile() {
    if (!currentUser) return;

    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error || !profile) {
        showToast("Error", "Could not fetch profile metadata.", "error");
        return;
    }

    document.getElementById('profile-username-display').textContent = profile.username;
    document.getElementById('settings-username').value = profile.username;
    
    const badge = document.getElementById('profile-role-badge');
    badge.textContent = profile.role;
    
    const redeemBlock = document.getElementById('redeem-key-block');
    const createBlock = document.getElementById('create-key-block');
    const roleSelect = document.getElementById('create-key-role');
    if (profile.role === 'superadmin' || profile.role === 'admin') {
        badge.className = "mt-1 px-3 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-cyan-100 text-cyan-800 border border-cyan-200";

        redeemBlock.classList.add('hidden');
        createBlock.classList.remove('hidden');
        
        roleSelect.innerHTML = '';
        if (profile.role === 'superadmin') {
            roleSelect.innerHTML = `
                <option value="admin">Admin</option>
                <option value="reviewer">Reviewer</option>
            `;
        } else if (profile.role === 'admin') {
            roleSelect.innerHTML = `
                <option value="reviewer">Reviewer</option>
            `;
        }
    } else {
        if (profile.role === 'reviewer') {
            badge.className = "mt-1 px-3 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200";
        } else {
            badge.className = "mt-1 px-3 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200";
        }
        redeemBlock.classList.remove('hidden');
        createBlock.classList.add('hidden');
    }

    if (profile.avatar_url) {
        document.getElementById('profile-avatar').src = profile.avatar_url;
    } else {
        document.getElementById('profile-avatar').src = `https://api.dicebear.com/7.x/initials/svg?seed=${profile.username}`;
    }
}

async function generatePromoKey() {
    const roleToGrant = document.getElementById('create-key-role').value;
    const container = document.getElementById('generated-key-container');
    const keyText = document.getElementById('generated-key-text');
    const copyBtn = document.getElementById('copy-key-btn');

    showToast("Processing", "Generating secure access token...", "info");
    if (container) container.classList.add('hidden');

    const { data: generatedCode, error } = await supabaseClient
        .rpc('generate_promotion_key', { 
            p_role_to_grant: roleToGrant 
        });

    if (error) {
        showToast("Generation Failure", error.message, "error");
    } else {
        if (keyText) keyText.textContent = generatedCode;
        if (copyBtn) {
            copyBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy
            `;
            copyBtn.disabled = false;
        }

        if (container) container.classList.remove('hidden');
        
        showToast("Key Created", `Token generated successfully for ${roleToGrant}!`, "success");
    }
}

function copyGeneratedKey() {
    const keyText = document.getElementById('generated-key-text');
    const copyBtn = document.getElementById('copy-key-btn');
    
    if (!keyText || !keyText.textContent) return;

    navigator.clipboard.writeText(keyText.textContent)
        .then(() => {
            showToast("Copied", "Token copied to clipboard!", "success");
            if (copyBtn) {
                copyBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span class="text-emerald-600 font-bold">Copied!</span>
                `;
            }
        })
        .catch(err => {
            showToast("Copy Error", "Could not copy token automatically.", "error");
        });
}

async function updateProfileInfo(event) {
    event.preventDefault();
    const newUsername = document.getElementById('settings-username').value.trim();
    if (!newUsername) return;

    const { error } = await supabaseClient
        .from('profiles')
        .update({ username: newUsername, updated_at: new Date().toISOString() })
        .eq('id', currentUser.id);

    if (error) {
        showToast("Update Failed", error.message, "error");
    } else {
        showToast("Profile Updated", "Your username was changed successfully.", "success");
        await fetchAndRenderProfile();
    }
}

async function uploadAvatar() {
    const fileInput = document.getElementById('avatar-upload');
    if (!fileInput.files || fileInput.files.length === 0) return;

    const file = fileInput.files[0];
    const fileExt = file.name.split('.').pop();
    const filePath = `${currentUser.id}/${Date.now()}.${fileExt}`;

    showToast("Uploading", "Processing picture storage handshake...", "info");

    const { data: uploadData, error: uploadError } = await supabaseClient.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

    if (uploadError) {
        showToast("Upload Error", uploadError.message, "error");
        return;
    }

    const { data: { publicUrl } } = supabaseClient.storage
        .from('avatars')
        .getPublicUrl(filePath);

    const { error: patchError } = await supabaseClient
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', currentUser.id);

    if (patchError) {
        showToast("Profile Patch Error", patchError.message, "error");
    } else {
        showToast("Success", "Avatar changed beautifully!", "success");
        await fetchAndRenderProfile();
    }
}

async function redeemPromoKey() {
    const tokenInput = document.getElementById('promo-key-input').value.trim();
    if (!tokenInput) {
        showToast("Validation Error", "Key field cannot be vacant.", "error");
        return;
    }

    const { data: grantedRole, error } = await supabaseClient
        .rpc('redeem_promotion_key', { token_code: tokenInput });

    if (error) {
        showToast("Activation Failure", error.message, "error");
    } else {
        showToast("Role Promoted", `Permissions elevated to: ${grantedRole}!`, "success");
        document.getElementById('promo-key-input').value = "";
        await fetchAndRenderProfile();
    }
}

async function deleteAccount() {
    const confirmation = confirm("CRITICAL WARNING: Are you sure you want to completely erase your profile information and credentials? This cannot be undone.");
    if (!confirmation) return;

    const { data, error } = await supabaseClient.functions.invoke('delete-account');

    if (error) {
        showToast("Deletion Lockout", error.message, "error");
    } else {
        alert("Account successfully deleted from database records.");
        window.location.href = "auth.html";
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = "auth.html";
}

window.addEventListener('DOMContentLoaded', checkSession);