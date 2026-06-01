let isSignUpMode = false;

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

function switchMode(signUp) {
    isSignUpMode = signUp;
    const tabSignIn = document.getElementById('tab-signin');
    const tabSignUp = document.getElementById('tab-signup');
    const usernameContainer = document.getElementById('username-container');
    const submitBtn = document.getElementById('submit-btn');

    if (isSignUpMode) {
        tabSignUp.className = "flex-1 pb-3 text-center font-semibold text-emerald-600 border-b-2 border-emerald-600 transition";
        tabSignIn.className = "flex-1 pb-3 text-center font-semibold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition";
        usernameContainer.classList.remove('hidden');
        document.getElementById('auth-username').required = true;
        submitBtn.textContent = "Create Account";
    } else {
        tabSignIn.className = "flex-1 pb-3 text-center font-semibold text-emerald-600 border-b-2 border-emerald-600 transition";
        tabSignUp.className = "flex-1 pb-3 text-center font-semibold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition";
        usernameContainer.classList.add('hidden');
        document.getElementById('auth-username').required = false;
        submitBtn.textContent = "Sign In to Platform";
    }
}

async function handleAuth(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const submitBtn = document.getElementById('submit-btn');

    submitBtn.disabled = true;

    if (isSignUpMode) {
        const username = document.getElementById('auth-username').value.trim();
        if (!username) {
            showToast("Validation Error", "Username is required.", "error");
            submitBtn.disabled = false;
            return;
        }

        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { username: username }
            }
        });

        if (error) {
            showToast("Registration Failed", error.message, "error");
        } else {
            showToast("Success!", "Account registered. Check email or try logging in.", "success");
            switchMode(false);
        }
    } else {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            showToast("Authentication Failed", error.message, "error");
        } else {
            showToast("Welcome Back", "Redirecting to workspace...", "success");
            setTimeout(() => {
                window.location.href = "index.html";
            }, 1000);
        }
    }
    submitBtn.disabled = false;
}

window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        window.location.href = "index.html";
    }
});