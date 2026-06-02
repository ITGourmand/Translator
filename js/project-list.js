
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

        const isAdminOrSuperadmin = currentUserProfile && (currentUserProfile.role === 'admin' || currentUserProfile.role === 'superadmin');
        
        let adminControlsHtml = '';
        if (isAdminOrSuperadmin) {
            adminControlsHtml = `
                <div class="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2 bg-slate-50 p-2.5 rounded-lg">
                    <div class="flex items-center justify-between gap-2">
                        <label class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Target Language:</label>
                        <select id="lang-select-${project.id}" class="text-xs border border-slate-200 rounded px-1.5 py-0.5 bg-white font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-cyan-500">
                            <option value="FR">🇫🇷 FR</option>
                            <option value="ES">🇪🇸 ES</option>
                            <option value="EN">🇬🇧 EN</option>
                            <option value="DE">🇩🇪 DE</option>
                        </select>
                    </div>
                    <div class="flex gap-2 justify-between mt-1">
                        <button onclick="handleDeleteProject(${project.id})" class="inline-flex items-center bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-semibold text-[11px] px-2.5 py-1 rounded-md transition">
                            Delete
                        </button>
                        <button onclick="triggerDownload(${project.id}, '${project.name.replace(/'/g, "\\'")}')" class="inline-flex items-center gap-1 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-[11px] px-2.5 py-1 rounded-md shadow-xs transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                            </svg>
                            Download .PO
                        </button>
                    </div>
                </div>
            `;
        }

        const card = document.createElement('div');
        card.className = "bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col justify-between relative overflow-hidden";
        card.innerHTML = `
            <div>
                <h3 class="text-base font-bold text-slate-900 truncate mb-1">${project.name}</h3>
                <p class="text-slate-400 text-xs flex items-center gap-1 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Created on ${creationDate}
                </p>
            </div>
            ${adminControlsHtml}
            <div class="pt-3 mt-2 border-t border-slate-100 flex justify-end">
                <a href="workspace.html?project_id=${project.id}" class="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-sm transition w-full justify-center">
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


async function handleDeleteProject(projectId) {
    const confirmation = confirm("Are you absolutely sure you want to delete this project? All sequence maps and translation metadata will be permanently lost.");
    if (!confirmation) return;

    showToast("Processing", "Purging project structural data...", "info");

    const { error } = await supabaseClient
        .from('projects')
        .delete()
        .eq('id', projectId);

    if (error) {
        showToast("Deletion Failure", error.message, "error");
    } else {
        showToast("Success", "Project cleanly wiped from system matrices.", "success");
        await fetchAndRenderProjects();
    }
}

function triggerDownload(projectId, projectName) {
    const langSelect = document.getElementById(`lang-select-${projectId}`);
    const selectedLang = langSelect ? langSelect.value : 'FR';
    downloadTranslatedPoFile(projectId, projectName, selectedLang);
}

async function downloadTranslatedPoFile(projectId, projectName, targetLanguage) {
    showToast("Exporting", "Fetching original .po template and compiling matrix translations...", "info");

    try {
        
        const { data: lines, error: linesError } = await supabaseClient
            .from('lines')
            .select('id, msgid, sequence_order')
            .eq('project_id', projectId)
            .order('sequence_order', { ascending: true });

        if (linesError) {
            showToast("Export Error", "Failed to compile original context lines.", "error");
            return;
        }

        
        const { data: approvedProposals, error: proposalsError } = await supabaseClient
            .from('proposals')
            .select('line_id, msgstr')
            .eq('language', targetLanguage)
            .eq('status', 'approved');

        if (proposalsError) {
            showToast("Export Error", "Failed to bridge matching target language blocks.", "error");
            return;
        }

        
        const translationMap = {};
        approvedProposals.forEach(prop => {
            translationMap[prop.line_id] = prop.msgstr;
        });

        
        const orderedTranslations = lines.map(line => ({
            msgstr: translationMap[line.id] || "" 
        }));

        
        const { data: files, error: listError } = await supabaseClient.storage
            .from('po-files')
            .list(currentUser.id);

        if (listError || !files) {
            showToast("Storage Error", "Could not scan secure storage for file template.", "error");
            return;
        }

        
        const targetFile = files.find(f => f.name.startsWith(`${projectId}_`));
        if (!targetFile) {
            showToast("Template Missing", "Original template file could not be located in storage.", "error");
            return;
        }

        const { data: blob, error: downloadError } = await supabaseClient.storage
            .from('po-files')
            .download(`${currentUser.id}/${targetFile.name}`);

        if (downloadError) {
            showToast("Download Error", "Failed to retrieve raw source file template.", "error");
            return;
        }

        const originalPoText = await blob.text();

        const originalLines = originalPoText.split(/\r?\n/);
        let resultLines = [];
        let dbIndex = 0;
        let i = 0;

        while (i < originalLines.length) {
            let line = originalLines[i];

            if (line.startsWith('msgid ')) {
                let msgidBlock = [line];
                let rawMsgidStr = line.substring(6).trim();
                i++;
                
                while (i < originalLines.length && originalLines[i].startsWith('"')) {
                    msgidBlock.push(originalLines[i]);
                    rawMsgidStr += originalLines[i].trim();
                    i++;
                }

                resultLines.push(...msgidBlock);
                
                const isHeader = (rawMsgidStr === '""');

                while (i < originalLines.length && !originalLines[i].startsWith('msgstr')) {
                    resultLines.push(originalLines[i]);
                    i++;
                }

                if (i < originalLines.length && originalLines[i].startsWith('msgstr')) {
                    if (isHeader) {
                        resultLines.push(originalLines[i]);
                        i++;
                        while (i < originalLines.length && originalLines[i].startsWith('"')) {
                            resultLines.push(originalLines[i]);
                            i++;
                        }
                    } else {
                        i++;
                        while (i < originalLines.length && originalLines[i].startsWith('"')) {
                            i++;
                        }

                        let approvedText = "";
                        if (dbIndex < orderedTranslations.length) {
                            approvedText = orderedTranslations[dbIndex].msgstr;
                            dbIndex++;
                        }

                        const escapedMsgstr = approvedText.replace(/"/g, '\\"').replace(/\n/g, '\\n');
                        resultLines.push(`msgstr "${escapedMsgstr}"`);
                    }
                }
            } else {
                resultLines.push(line);
                i++;
            }
        }
        const sanitizedName = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'project';
        const fileName = `${sanitizedName}_export_${targetLanguage}.po`;

        const finalBlob = new Blob([resultLines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const downloadUrl = URL.createObjectURL(finalBlob);
        
        const transientLink = document.createElement('a');
        transientLink.href = downloadUrl;
        transientLink.download = fileName;
        
        document.body.appendChild(transientLink);
        transientLink.click();
        
        document.body.removeChild(transientLink);
        URL.revokeObjectURL(downloadUrl);

        showToast("Export Complete", `File saved cleanly as ${fileName}`, "success");

    } catch (err) {
        showToast("Unexpected Exception", err.message, "error");
    }
}

window.handleDeleteProject = handleDeleteProject;
window.triggerDownload = triggerDownload;

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


window.addEventListener('DOMContentLoaded', checkSession);