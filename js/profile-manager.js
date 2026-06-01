let currentUser = null;

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const borderColors = {
        success: 'border-emerald-500 bg-white text-slate-800 shadow-md',
        error: 'border-red-500 bg-white text-slate-800 shadow-md',
        info: 'border-cyan-500 bg-white text-slate-800 shadow-md'
    };

    toast.className = `p-4 border-l-4 rounded-r-lg shadow-lg flex flex-col transition duration-300 transform translate-y-2 ${borderColors[type] || borderColors.info}`;
    toast.innerHTML = `
        <strong class="font-bold text-sm text-slate-900">${title}</strong>
        <span class="text-xs text-slate-600 mt-0.5">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

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
    if (profile.role === 'superadmin' || profile.role === 'admin') {
        badge.className = "mt-1 px-3 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-cyan-100 text-cyan-800 border border-cyan-200";
    } else if (profile.role === 'reviewer') {
        badge.className = "mt-1 px-3 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200";
    } else {
        badge.className = "mt-1 px-3 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200";
    }

    if (profile.avatar_url) {
        document.getElementById('profile-avatar').src = profile.avatar_url;
    } else {
        document.getElementById('profile-avatar').src = `https://api.dicebear.com/7.x/initials/svg?seed=${profile.username}`;
    }
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