// project-list.js
let currentUser = null;
let currentUserProfile = null;

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
    await fetchUserProfile();
    await fetchAndRenderProjects();
}

async function fetchUserProfile() {
    if (!currentUser) return;

    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error || !profile) {
        showToast("Session Error", "Could not synchronize account profile credentials.", "error");
        return;
    }

    currentUserProfile = profile;
    document.getElementById('welcome-username').textContent = profile.username;
    
    const badge = document.getElementById('user-role-badge');
    badge.textContent = profile.role;

    if (profile.role === 'superadmin' || profile.role === 'admin') {
        badge.className = "px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-cyan-100 text-cyan-800 border border-cyan-200";
        // Unlocks the administration PO ingestion interface
        document.getElementById('admin-panel').classList.remove('hidden');
    } else if (profile.role === 'reviewer') {
        badge.className = "px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200";
    } else {
        badge.className = "px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200";
    }
}

async function fetchAndRenderProjects() {
    const grid = document.getElementById('project-grid');
    const countBadge = document.getElementById('project-count');

    const { data: projects, error } = await supabaseClient
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        showToast("Fetch Failure", "Failed to retrieve project listings.", "error");
        return;
    }

    // Clean initial loader states
    grid.innerHTML = "";
    countBadge.textContent = projects.length;

    if (projects.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white p-8 border border-dashed border-slate-200 text-center rounded-xl">
                <p class="text-slate-400 text-sm font-medium">No localization projects are active at this moment.</p>
            </div>
        `;
        return;
    }

    projects.forEach(project => {
        const creationDate = new Date(project.created_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
        });

        const card = document.createElement('div');
        card.className = "bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col justify-between relative overflow-hidden";
        card.innerHTML = `
            <div>
                <h3 class="text-base font-bold text-slate-900 truncate mb-1">${project.name}</h3>
                <p class="text-slate-400 text-xs flex items-center gap-1 mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Created on ${creationDate}
                </p>
            </div>
            <div class="pt-2 border-t border-slate-100 flex justify-end">
                <a href="translate.html?project_id=${project.id}" class="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-sm transition">
                    Open Focus Hub
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </a>
            </div>
        `;
        grid.appendChild(card);
    });
}


async function handleCreateProject(event) {
    event.preventDefault();
    
    const submitBtn = document.getElementById('upload-submit-btn');
    const projectNameInput = document.getElementById('project-name');
    const fileInput = document.getElementById('po-file-input');

    if (!fileInput.files || fileInput.files.length === 0) {
        showToast("Validation Error", "Please provide a valid .po localization script file.", "error");
        return;
    }

    const projectName = projectNameInput.value.trim();
    const file = fileInput.files[0];

    submitBtn.disabled = true;
    showToast("Processing", "Creating base project infrastructure...", "info");

    try {
        // Step 1: Insert project structural metadata record into the public database
        const { data: project, error: projectError } = await supabaseClient
            .from('projects')
            .insert({ name: projectName })
            .select()
            .single();

        if (projectError || !project) {
            showToast("Database Rejection", projectError.message, "error");
            submitBtn.disabled = false;
            return;
        }

        // Step 2: Stream the raw text file directly to your 'po-files' storage bucket
        submitBtn.innerHTML = `<span class="animate-pulse">Uploading script to secure storage...</span>`;
        const fileExt = file.name.split('.').pop();
        const filePath = `${currentUser.id}/${project.id}_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabaseClient.storage
            .from('po-files')
            .upload(filePath, file);

        if (uploadError) {
            showToast("Storage Error", uploadError.message, "error");
            submitBtn.disabled = false;
            return;
        }

        // Step 3: Trigger the server-side Deno Edge Function to run parsing in the background
        submitBtn.innerHTML = `<span class="animate-pulse">Server parsing matrix lines...</span>`;
        
        const { data: functionData, error: functionError } = await supabaseClient
            .functions
            .invoke('parse-po-file', {
                body: { filePath: filePath, projectId: project.id }
            });

        if (functionError) {
            showToast("Edge Processing Error", functionError.message, "error");
        } else {
            showToast("Success!", `Project registered with ${functionData.totalImported} server-parsed sequence lines!`, "success");
            projectNameInput.value = "";
            fileInput.value = "";
            await fetchAndRenderProjects();
        }

    } catch (err) {
        showToast("Unexpected Exception", err.message, "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Ingest & Create Project";
    }
}

async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = "auth.html";
}

// Initializing DOM trigger listener hooks
window.addEventListener('DOMContentLoaded', checkSession);