// js/translation-hub.js
let projectId = null;
let currentUser = null;
let userProfile = null;

// Variables d'état chirurgicales (Plus de tableau saturé en mémoire !)
let totalLinesCount = 0;       
let currentSequenceOrder = 1; // Index linéaire réel de la ligne active (1-based)
let activeLineRef = null;
let userPendingProposalRef = null;

let currentLanguage = 'FR';

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

// Initialisation de la session
async function verifySession() {
    const params = new URLSearchParams(window.location.search);
    projectId = params.get('project_id');

    if (!projectId) {
        alert("Missing context mapping parameters. Returning to main directory.");
        window.location.href = "index.html";
        return;
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = "auth.html";
        return;
    }

    currentUser = session.user;
    await fetchProfileAndPermissions();
    await fetchProjectMetadata();
    await loadProjectSequenceMatrix();

    supabaseClient
    .channel('schema-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'proposals' }, () => {
        if (activeLineRef) fetchAndRenderProposals(activeLineRef.id);
        updateMetricsTracker();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lines' }, (payload) => {
        if (activeLineRef && payload.new.id === activeLineRef.id) {
            refreshCarouselWorkspace();
        }
    })
    .subscribe();
}

async function fetchProfileAndPermissions() {
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (error || !profile) {
        showToast("Authorization Error", "Profile credential verification rejected.", "error");
        return;
    }
    userProfile = profile;
}

function handleLanguageChange() {
    currentLanguage = document.getElementById('target-language-select').value;
    if (activeLineRef) {
        refreshCarouselWorkspace();
    }
}


async function fetchProjectMetadata() {
    const { data: project, error } = await supabaseClient
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();

    if (!error && project) {
        document.getElementById('nav-project-name').textContent = project.name;
    }
}

// Extraction chirurgicale des métadonnées globales
async function loadProjectSequenceMatrix() {
    const { count, error } = await supabaseClient
        .from('lines')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);

    if (error) {
        showToast("Error", "Could not synchronize line keys architecture map.", "error");
        return;
    }

    totalLinesCount = count || 0;
    document.getElementById('total-lines-badge').textContent = totalLinesCount;

    if (totalLinesCount > 0) {
        currentSequenceOrder = 1;
        await refreshCarouselWorkspace();
        await updateMetricsTracker();
    } else {
        document.getElementById('card-active-msgid').textContent = "This project does not contain operational matrix strings yet.";
    }
}

async function updateMetricsTracker() {
    if (totalLinesCount === 0) return;

    const { count, error } = await supabaseClient
        .from('lines')
        .select('id, proposals!inner(id)', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('proposals.status', 'approved')
        .eq('proposals.language', currentLanguage);

    if (error) return;

    const completionPercent = Math.round(((count || 0) / totalLinesCount) * 100);
    document.getElementById('project-progress-bar').style.width = `${completionPercent}%`;
    document.getElementById('project-progress-text').textContent = `${completionPercent}% Done`;
}

// Carousel ultra-focalisé ($N-1, $N, $N+1) sans aucun tableau local global
async function refreshCarouselWorkspace() {
    if (totalLinesCount === 0) return;

    document.getElementById('direct-line-input').value = currentSequenceOrder;
    document.getElementById('proposal-textarea').value = "";

    const isReviewerOrAdmin = ['reviewer', 'admin', 'superadmin'].includes(userProfile?.role);

    // 1. Chargement de la ligne active (N)
    const { data: activeLine, error } = await supabaseClient
        .from('lines')
        .select('*')
        .eq('project_id', projectId)
        .eq('sequence_order', currentSequenceOrder)
        .single();

    if (!error && activeLine) {
        activeLineRef = activeLine;
        document.getElementById('card-active-num').textContent = activeLine.sequence_order;
        document.getElementById('card-active-msgid').textContent = activeLine.msgid;

        const isLanguageLocked = activeLine.locked_languages?.includes(currentLanguage) || false;

        const lockContainer = document.getElementById('lock-control-container');
        if (isReviewerOrAdmin) {
            lockContainer.innerHTML = `
                <button onclick="toggleLineLock()" class="px-2.5 py-1 text-xs font-bold rounded-md border transition ${
                    isLanguageLocked 
                    ? 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200' 
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                }">
                    ${isLanguageLocked ? `🔓 Unlock ${currentLanguage}` : `🔒 Lock ${currentLanguage}`}
                </button>
            `;
        } else {
            lockContainer.innerHTML = isLanguageLocked ? `<span class="text-xs text-red-600 font-bold bg-red-50 px-2 py-1 rounded border border-red-200">🔒 ${currentLanguage} Locked</span>` : '';
        }

        // Restriction d'accès au formulaire de proposition si la langue courante est verrouillée
        const textarea = document.getElementById('proposal-textarea');
        const submitBtn = document.getElementById('submit-proposal-btn');
        if (isLanguageLocked) {
            textarea.disabled = true;
            textarea.placeholder = `The ${currentLanguage} translation has been locked. No new proposals are allowed.`;
            submitBtn.disabled = true;
            submitBtn.className = "bg-slate-300 text-slate-500 font-semibold text-xs px-5 py-2.5 rounded-lg cursor-not-allowed";
        } else {
            textarea.disabled = false;
            textarea.placeholder = "Type your translation alternative here... Keep layout keys and variables safe.";
            submitBtn.disabled = false;
            submitBtn.className = "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-5 py-2.5 rounded-lg shadow transition";
        }

        await fetchAndRenderProposals(activeLine.id);
    }

    // 2. Chargement du contexte haut (N-1)
    if (currentSequenceOrder > 1) {
        const { data: pData } = await supabaseClient.from('lines').select('msgid, sequence_order').eq('project_id', projectId).eq('sequence_order', currentSequenceOrder - 1).single();
        if (pData) {
            document.getElementById('card-prev-num').textContent = pData.sequence_order;
            document.getElementById('card-prev-text').textContent = pData.msgid;
            document.getElementById('card-prev').classList.remove('hidden');
        }
    } else {
        document.getElementById('card-prev').classList.add('hidden');
    }

    // 3. Chargement du contexte bas (N+1)
    if (currentSequenceOrder < totalLinesCount) {
        const { data: nData } = await supabaseClient.from('lines').select('msgid, sequence_order').eq('project_id', projectId).eq('sequence_order', currentSequenceOrder + 1).single();
        if (nData) {
            document.getElementById('card-next-num').textContent = nData.sequence_order;
            document.getElementById('card-next-text').textContent = nData.msgid;
            document.getElementById('card-next').classList.remove('hidden');
        }
    } else {
        document.getElementById('card-next').classList.add('hidden');
    }

    document.getElementById('btn-prev-line').disabled = (currentSequenceOrder === 1);
    document.getElementById('btn-next-line').disabled = (currentSequenceOrder === totalLinesCount);
}

// Commutateur de Verrouillage (Lock System)
async function toggleLineLock() {
    if (!activeLineRef) return;
    const isReviewerOrAdmin = ['reviewer', 'admin', 'superadmin'].includes(userProfile?.role);
    if (!isReviewerOrAdmin) return;

    let currentLockedList = activeLineRef.locked_languages || [];
    const isLanguageLocked = currentLockedList.includes(currentLanguage);

    let newLockedLanguages = isLanguageLocked
        ? currentLockedList.filter(lang => lang !== currentLanguage)
        : [...currentLockedList, currentLanguage];

    const { error } = await supabaseClient
        .from('lines')
        .update({ locked_languages: newLockedLanguages })
        .eq('id', activeLineRef.id);

    if (error) {
        showToast("Lock Action Error", error.message, "error");
    } else {
        showToast("Success", isLanguageLocked ? `${currentLanguage} successfully unlocked.` : `${currentLanguage} successfully locked.`, "success");
        await refreshCarouselWorkspace();
    }
}

// Rendu collaboratif et intelligent des propositions
async function fetchAndRenderProposals(lineId) {
    const listContainer = document.getElementById('proposals-list');
    const titleCount = document.getElementById('proposals-title-count');
    const textarea = document.getElementById('proposal-textarea');
    const submitBtn = document.getElementById('submit-proposal-btn');
    const actionsContainer = document.getElementById('form-actions-container');

    const { data: proposals, error } = await supabaseClient
        .from('proposals')
        .select(`id, line_id, user_id, msgstr, status, created_at, language, profiles ( username, role )`)
        .eq('line_id', lineId)
        .eq('language', currentLanguage)
        .order('created_at', { ascending: false });

    if (error) {
        listContainer.innerHTML = `<p class="text-xs text-red-500">Failed to pull proposal array history records.</p>`;
        return;
    }

    const isLocked = activeLineRef?.locked_languages?.includes(currentLanguage) || false;
    const hasApproved = proposals.some(p => p.status === 'approved');
    const myPending = proposals.find(p => p.user_id === currentUser.id && p.status === 'pending');
    let deleteBtn = document.getElementById('delete-proposal-btn');

    if (myPending && !isLocked) {
        userPendingProposalRef = myPending;
        submitBtn.textContent = "Edit proposal";
        submitBtn.className = "bg-brandCyan-600 hover:bg-brandCyan-700 text-white font-medium text-xs px-5 py-3 rounded-xl shadow transition tracking-wide";
        
        if (!textarea.value.trim()) {
            textarea.value = myPending.msgstr;
        }
        if (!deleteBtn && actionsContainer) {
            deleteBtn = document.createElement('button');
            deleteBtn.id = 'delete-proposal-btn';
            deleteBtn.type = 'button';
            deleteBtn.onclick = handleDeleteProposal;
            deleteBtn.className = "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-medium text-xs px-5 py-3 rounded-xl transition tracking-wide";
            deleteBtn.textContent = "Delete";
            actionsContainer.insertBefore(deleteBtn, submitBtn);
        }
    } else {
        userPendingProposalRef = null;

        if (deleteBtn) deleteBtn.remove();

        if (!isLocked) {
            submitBtn.textContent = "Submit Translation";
            submitBtn.className = "bg-brandGreen-700 hover:bg-brandGreen-800 text-white font-medium text-xs px-5 py-3 rounded-xl shadow transition tracking-wide";
        }
    }

    let proposalsToRender = proposals;
    if (isLocked && hasApproved) {
        proposalsToRender = proposals.filter(p => p.status === 'approved');
        titleCount.textContent = `Approved Translation (Locked 🔒)`;
    } else {
        titleCount.textContent = `Active Proposals (${proposals.length})`;
    }

    listContainer.innerHTML = "";

    if (proposalsToRender.length === 0) {
        listContainer.innerHTML = `<p class="text-xs text-stone-400 italic">No alternative proposals registered yet.</p>`;
        return;
    }

    const isReviewerOrAdmin = ['reviewer', 'admin', 'superadmin'].includes(userProfile?.role);

    proposalsToRender.forEach(prop => {
        const authorName = prop.profiles?.username || "Unknown Translator";
        const dateString = new Date(prop.created_at).toLocaleDateString('en-US', {
            hour: '2-digit', minute: '2-digit'
        });

        let badgeStyle = "bg-slate-100 text-slate-700";
        if (prop.status === 'approved') badgeStyle = "bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold";
        if (prop.status === 'rejected') badgeStyle = "bg-red-100 text-red-800 border border-red-200";

        const lockedVisualClass = isLocked ? 'opacity-60 bg-slate-50' : 'bg-white';

        const item = document.createElement('div');
        item.className = `p-3 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${prop.status === 'approved' ? 'border-emerald-500 bg-emerald-50/20 shadow-xs' : 'border-slate-200'} ${lockedVisualClass}`;
        
        // --- BLOC D'ACTIONS DES CARTES CONFIGURÉ ---
        let actionButtons = [];
        const isOwner = prop.user_id === currentUser.id;

        if (!isLocked) {
            // Droits Reviewer / Admin
            if (isReviewerOrAdmin) {
                if (prop.status !== 'approved') {
                    actionButtons.push(`<button onclick="alterProposalStatus(${prop.id}, 'approved')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-2 py-1 rounded shadow-sm transition">Approve</button>`);
                }
                if (prop.status !== 'rejected') {
                    actionButtons.push(`<button onclick="alterProposalStatus(${prop.id}, 'rejected')" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[10px] px-2 py-1 rounded transition">Reject</button>`);
                }
            }
            
            if (isOwner && prop.status === 'pending') {
                actionButtons.push(`<button onclick="handleDeleteProposal()" class="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-[10px] px-2 py-1 rounded transition border border-red-200">Delete</button>`);
            }
        }

        let actionsHtml = "";
        if (actionButtons.length > 0) {
            actionsHtml = `<div class="flex gap-1.5 self-end sm:self-center">${actionButtons.join('')}</div>`;
        }
        // --------------------------------------------

        item.innerHTML = `
            <div class="space-y-1 max-w-xl w-full">
                <p class="font-mono text-xs text-slate-900 break-words whitespace-pre-wrap">${prop.msgstr}</p>
                <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                    <span class="font-medium text-slate-600">@${authorName}</span>
                    <span>•</span>
                    <span>${dateString}</span>
                    <span class="px-2 py-0.5 rounded-full text-[10px] tracking-wide uppercase ${badgeStyle}">${prop.status}</span>
                </div>
            </div>
            ${actionsHtml}
        `;
        listContainer.appendChild(item);
    });
}

async function handleDeleteProposal() {
    if (!userPendingProposalRef) return;

    const confirmation = confirm("Do you really want to delete your pending proposal?");
    if (!confirmation) return;

    const deleteBtn = document.getElementById('delete-proposal-btn');
    const submitBtn = document.getElementById('submit-proposal-btn');
    
    if (deleteBtn) deleteBtn.disabled = true;
    if (submitBtn) submitBtn.disabled = true;

    const { error } = await supabaseClient
        .from('proposals')
        .delete()
        .eq('id', userPendingProposalRef.id);

    if (error) {
        showToast("Error", "Unable to delete the proposal:" + error.message, "error");
        if (deleteBtn) deleteBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
    } else {
        showToast("Success", "Your suggestion has been deleted.", "success");
        
        document.getElementById('proposal-textarea').value = "";
        await refreshCarouselWorkspace();
    }
}

// Soumission des propositions
async function handleProposalSubmission(event) {
    if (event) event.preventDefault();
    if (!activeLineRef || activeLineRef.is_locked) return;

    const textInput = document.getElementById('proposal-textarea');
    const submitBtn = document.getElementById('submit-proposal-btn');
    const targetStringValue = textInput.value.trim();

    if (!targetStringValue) {
        showToast("Error", "Translation proposal cannot be empty.", "error");
        return;
    }

    submitBtn.disabled = true;

    if (userPendingProposalRef) {
        const { error } = await supabaseClient
            .from('proposals')
            .update({ msgstr: targetStringValue })
            .eq('id', userPendingProposalRef.id);

        if (error) {
            showToast("Modification Rejected", error.message, "error");
            submitBtn.disabled = false;
        } else {
            showToast("Success", "Translation proposal updated.", "success");
            await refreshCarouselWorkspace();
        }
    } else {
        const { error } = await supabaseClient
            .from('proposals')
            .insert({
                line_id: activeLineRef.id,
                user_id: currentUser.id,
                msgstr: targetStringValue,
                language: currentLanguage,
                status: 'pending'
            });

        if (error) {
            showToast("Submission Rejected", error.message, "error");
            submitBtn.disabled = false;
        } else {
            showToast("Success", "Translation proposal recorded.", "success");
            textInput.value = "";
            await refreshCarouselWorkspace();
        }
    }
}

// Modération exclusive : Approuver une proposition rejette automatiquement toutes les autres ET verrouille la ligne
async function alterProposalStatus(proposalId, newStatus) {
    if (!activeLineRef) return;

    try {
        if (newStatus === 'approved') {
            // Étape 1 : Met TOUTES les autres propositions de cette ligne à 'rejected'
            await supabaseClient
                .from('proposals')
                .update({ status: 'rejected' })
                .eq('line_id', activeLineRef.id)
                .eq('language', currentLanguage)
                .neq('id', proposalId);

            // Étape 2 : Verrouille automatiquement la ligne source (Lock automatique à l'acceptation)
            let currentLockedList = activeLineRef.locked_languages || [];
            if (!currentLockedList.includes(currentLanguage)) {
                currentLockedList.push(currentLanguage);
            }

            await supabaseClient
                .from('lines')
                .update({ locked_languages: currentLockedList })
                .eq('id', activeLineRef.id);
        }

        // Étape 3 : Applique le statut cible à la proposition sélectionnée
        const { error } = await supabaseClient
            .from('proposals')
            .update({ status: newStatus })
            .eq('id', proposalId);

        if (error) throw error;

        showToast("Status Updated", `Proposal records updated to: ${newStatus}`, "success");
        await refreshCarouselWorkspace();
        await updateMetricsTracker();

    } catch (err) {
        showToast("Action Lockout", err.message, "error");
    }
}

// Navigation linéaire séquentielle
function navigateLine(direction) {
    const nextSequence = currentSequenceOrder + direction;
    if (nextSequence >= 1 && nextSequence <= totalLinesCount) {
        currentSequenceOrder = nextSequence;
        refreshCarouselWorkspace();
    }
}

// Module de saut direct
function handleDirectLineJump() {
    const targetValue = parseInt(document.getElementById('direct-line-input').value, 10);
    
    if (isNaN(targetValue) || targetValue < 1 || targetValue > totalLinesCount) {
        showToast("Navigation Failure", `Please input a line index between 1 and ${totalLinesCount}.`, "error");
        document.getElementById('direct-line-input').value = currentSequenceOrder;
        return;
    }

    currentSequenceOrder = targetValue;
    refreshCarouselWorkspace();
}

// Recherche de la prochaine ligne non traduite (Scalable à 28 800+ lignes)
async function jumpToNextUntranslated() {
    if (totalLinesCount === 0) return;

    showToast("Scanning", "Searching for next vacant segment entries...", "info");

    const { data: targetSequence, error } = await supabaseClient
        .rpc('get_next_untranslated_line', {
            p_project_id: projectId,
            p_current_sequence: currentSequenceOrder,
            p_total_lines: totalLinesCount,
            p_language: currentLanguage // <-- Ajout du paramètre manquant ici
        });

    if (error) {
        showToast("Error", "Could not scan string state matrices.", "error");
        return;
    }

    if (targetSequence !== -1) {
        currentSequenceOrder = targetSequence;
        await refreshCarouselWorkspace();
    } else {
        showToast("Matrix Solved", "All sequence slots have approved translations mapped!", "success");
    }
}

// Raccourcis clavier (Ctrl + Enter)
document.addEventListener('keydown', (e) => {
    if (e.target.id === 'proposal-textarea' && e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleProposalSubmission();
    }
});

window.addEventListener('DOMContentLoaded', verifySession);