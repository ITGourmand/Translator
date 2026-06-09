import { ALLOWED_LANGUAGES, isReviewerRole } from "../core/constants.js";
import { appendMessage, byId, clearElement, createElement, setText } from "../core/dom.js";
import { fetchCurrentProfile, requireSession, supabaseClient } from "../core/supabase.js";
import { showToast } from "../core/toast.js";
import {
    configureLanguageSelect,
    firstLanguageExcept,
    normalizeLanguage,
    normalizePositiveInteger,
    requireRecordId,
} from "../core/validation.js";

let projectId = null;
let currentUser = null;
let userProfile = null;
let totalLinesCount = 0;
let currentSequenceOrder = 1;
let activeLineRef = null;
let userPendingProposalRef = null;
let currentLanguage = "FR";
let projectSourceLanguage = "EN";

function updateURLParams() {
    if (!projectId) return;
    const params = new URLSearchParams(window.location.search);
    params.set("project_id", projectId);
    params.set("line", String(currentSequenceOrder));
    params.set("lang", currentLanguage);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
}

async function fetchProfileAndPermissions() {
    const profile = await fetchCurrentProfile(currentUser.id);
    if (!profile) {
        showToast("Authorization Error", "Profile verification failed.", "error");
        return null;
    }
    userProfile = profile;
    return profile;
}

async function fetchProjectMetadata() {
    const { data: project, error } = await supabaseClient
        .from("projects")
        .select("name, source_language")
        .eq("id", projectId)
        .maybeSingle();

    if (error || !project) {
        alert("This project does not exist. Returning to dashboard.");
        window.location.href = "index.html";
        return false;
    }

    projectSourceLanguage = normalizeLanguage(project.source_language, "EN");
    setText(byId("nav-project-name"), project.name || "Untitled Project");
    return true;
}

async function loadProjectSequenceMatrix() {
    const { count, error } = await supabaseClient
        .from("lines")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId);

    if (error) {
        showToast("Error", "Could not load project lines.", "error");
        return;
    }

    totalLinesCount = count || 0;
    setText(byId("total-lines-badge"), totalLinesCount);

    if (totalLinesCount === 0) {
        setText(byId("card-active-msgid"), "This project does not contain any source strings yet.");
        return;
    }

    if (currentSequenceOrder < 1 || currentSequenceOrder > totalLinesCount) {
        currentSequenceOrder = 1;
    }

    await refreshCarouselWorkspace();
    await updateMetricsTracker();
}

async function updateMetricsTracker() {
    if (totalLinesCount === 0) return;

    const { count, error } = await supabaseClient
        .from("lines")
        .select("id, proposals!inner(id)", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("proposals.status", "approved")
        .eq("proposals.language", currentLanguage);

    if (error) return;

    const completionPercent = Math.round(((count || 0) / totalLinesCount) * 100);
    byId("project-progress-bar").style.width = `${completionPercent}%`;
    setText(byId("project-progress-text"), `${completionPercent}% Done`);
}

function setProposalFormLocked(isLanguageLocked) {
    const textarea = byId("proposal-textarea");
    const submitBtn = byId("submit-proposal-btn");

    textarea.disabled = isLanguageLocked;
    textarea.placeholder = isLanguageLocked
        ? `The ${currentLanguage} translation has been locked. No new proposals are allowed.`
        : "Type your translation alternative here... Keep layout keys and variables safe.";

    submitBtn.disabled = isLanguageLocked;
    submitBtn.className = isLanguageLocked
        ? "bg-stone-300 text-stone-500 font-semibold text-xs px-5 py-2.5 rounded-lg cursor-not-allowed"
        : "bg-brandGreen-700 hover:bg-brandGreen-800 text-white font-semibold text-xs px-5 py-2.5 rounded-lg shadow transition";
}

function renderLockControl(isLanguageLocked) {
    const lockContainer = byId("lock-control-container");
    clearElement(lockContainer);

    if (isReviewerRole(userProfile?.role)) {
        lockContainer.appendChild(createElement("button", {
            type: "button",
            className: `px-2.5 py-1 text-xs font-bold rounded-md border transition ${
                isLanguageLocked
                    ? "bg-red-100 text-red-700 border-red-300 hover:bg-red-200"
                    : "bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-200"
            }`,
            text: isLanguageLocked ? `Unlock ${currentLanguage}` : `Lock ${currentLanguage}`,
            dataset: { action: "toggle-lock" },
        }));
        return;
    }

    if (isLanguageLocked) {
        lockContainer.appendChild(createElement("span", {
            className: "text-xs text-red-600 font-bold bg-red-50 px-2 py-1 rounded border border-red-200",
            text: `${currentLanguage} Locked`,
        }));
    }
}

async function loadContextLine(sequenceOrder, numId, textId, cardId) {
    const card = byId(cardId);
    const { data } = await supabaseClient
        .from("lines")
        .select("msgid, sequence_order")
        .eq("project_id", projectId)
        .eq("sequence_order", sequenceOrder)
        .single();

    if (!data) {
        card.classList.add("hidden");
        return;
    }

    setText(byId(numId), data.sequence_order);
    setText(byId(textId), data.msgid);
    card.classList.remove("hidden");
}

async function refreshCarouselWorkspace() {
    if (totalLinesCount === 0) return;

    byId("direct-line-input").value = currentSequenceOrder;
    byId("proposal-textarea").value = "";

    configureLanguageSelect(byId("target-language-select"), {
        excludedLanguage: projectSourceLanguage,
        selectedLanguage: currentLanguage,
    });
    updateURLParams();

    const { data: activeLine, error } = await supabaseClient
        .from("lines")
        .select("*")
        .eq("project_id", projectId)
        .eq("sequence_order", currentSequenceOrder)
        .single();

    if (error || !activeLine) {
        showToast("Load Error", "Could not load the selected source line.", "error");
        return;
    }

    activeLineRef = activeLine;
    setText(byId("card-active-num"), activeLine.sequence_order);
    setText(byId("card-active-msgid"), activeLine.msgid);

    const isLanguageLocked = activeLine.locked_languages?.includes(currentLanguage) || false;
    renderLockControl(isLanguageLocked);
    setProposalFormLocked(isLanguageLocked);
    await fetchAndRenderProposals(activeLine.id);

    if (currentSequenceOrder > 1) {
        await loadContextLine(currentSequenceOrder - 1, "card-prev-num", "card-prev-text", "card-prev");
    } else {
        byId("card-prev").classList.add("hidden");
    }

    if (currentSequenceOrder < totalLinesCount) {
        await loadContextLine(currentSequenceOrder + 1, "card-next-num", "card-next-text", "card-next");
    } else {
        byId("card-next").classList.add("hidden");
    }

    byId("btn-prev-line").disabled = currentSequenceOrder === 1;
    byId("btn-next-line").disabled = currentSequenceOrder === totalLinesCount;
}

async function toggleLineLock() {
    if (!activeLineRef || !isReviewerRole(userProfile?.role)) return;

    const currentLockedList = activeLineRef.locked_languages || [];
    const isLanguageLocked = currentLockedList.includes(currentLanguage);
    const newLockedLanguages = isLanguageLocked
        ? currentLockedList.filter((language) => language !== currentLanguage)
        : [...currentLockedList, currentLanguage];

    const { error } = await supabaseClient
        .from("lines")
        .update({ locked_languages: newLockedLanguages })
        .eq("id", activeLineRef.id);

    if (error) {
        showToast("Lock Error", error.message, "error");
        return;
    }

    showToast(
        "Success",
        isLanguageLocked ? `${currentLanguage} unlocked.` : `${currentLanguage} locked.`,
        "success",
    );
    await refreshCarouselWorkspace();
}

function setSubmitButtonForPendingProposal(hasPending, isLocked) {
    const submitBtn = byId("submit-proposal-btn");
    if (isLocked) return;

    submitBtn.textContent = hasPending ? "Edit proposal" : "Submit Translation";
    submitBtn.className = hasPending
        ? "bg-brandCyan-600 hover:bg-brandCyan-700 text-white font-medium text-xs px-5 py-3 rounded-xl shadow transition tracking-wide"
        : "bg-brandGreen-700 hover:bg-brandGreen-800 text-white font-medium text-xs px-5 py-3 rounded-xl shadow transition tracking-wide";
}

function syncPendingProposalActions(myPending, isLocked) {
    const actionsContainer = byId("form-actions-container");
    let deleteBtn = byId("delete-proposal-btn");

    if (myPending && !isLocked) {
        userPendingProposalRef = myPending;
        setSubmitButtonForPendingProposal(true, isLocked);

        const textarea = byId("proposal-textarea");
        if (!textarea.value.trim()) textarea.value = myPending.msgstr || "";

        if (!deleteBtn) {
            deleteBtn = createElement("button", {
                id: "delete-proposal-btn",
                type: "button",
                className: "bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-medium text-xs px-5 py-3 rounded-xl transition tracking-wide",
                text: "Delete",
                dataset: { action: "delete-proposal" },
            });
            actionsContainer.insertBefore(deleteBtn, byId("submit-proposal-btn"));
        }
        return;
    }

    userPendingProposalRef = null;
    if (deleteBtn) deleteBtn.remove();
    setSubmitButtonForPendingProposal(false, isLocked);
}

function proposalBadgeClass(status) {
    if (status === "approved") return "bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold";
    if (status === "rejected") return "bg-red-100 text-red-800 border border-red-200";
    return "bg-stone-100 text-stone-700";
}

function renderProposalActions(prop, isLocked) {
    const actions = createElement("div", { className: "flex gap-1.5 self-end sm:self-center" });
    const isOwner = prop.user_id === currentUser.id;

    if (isLocked) return actions;

    if (isReviewerRole(userProfile?.role)) {
        if (prop.status !== "approved") {
            actions.appendChild(createElement("button", {
                type: "button",
                className: "bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-2 py-1 rounded shadow-sm transition",
                text: "Approve",
                dataset: { action: "set-proposal-status", proposalId: prop.id, status: "approved" },
            }));
        }
        if (prop.status !== "rejected") {
            actions.appendChild(createElement("button", {
                type: "button",
                className: "bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold text-[10px] px-2 py-1 rounded transition",
                text: "Reject",
                dataset: { action: "set-proposal-status", proposalId: prop.id, status: "rejected" },
            }));
        }
    }

    if (isOwner && prop.status === "pending") {
        actions.appendChild(createElement("button", {
            type: "button",
            className: "bg-red-50 hover:bg-red-100 text-red-600 font-bold text-[10px] px-2 py-1 rounded transition border border-red-200",
            text: "Delete",
            dataset: { action: "delete-proposal" },
        }));
    }

    return actions;
}

function renderProposalItem(prop, isLocked) {
    const authorName = prop.profiles?.username || "Unknown Translator";
    const dateString = new Date(prop.created_at).toLocaleDateString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
    });

    const item = createElement("div", {
        className: `p-3 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            prop.status === "approved" ? "border-emerald-500 bg-emerald-50/20 shadow-xs" : "border-stone-200"
        } ${isLocked ? "opacity-60 bg-stone-50" : "bg-white"}`,
    });

    const body = createElement("div", { className: "space-y-1 max-w-xl w-full" }, [
        createElement("p", { className: "font-mono text-xs text-stone-900 break-words whitespace-pre-wrap", text: prop.msgstr || "" }),
        createElement("div", { className: "flex flex-wrap items-center gap-2 text-[11px] text-stone-400" }, [
            createElement("span", { className: "font-medium text-stone-600", text: `@${authorName}` }),
            createElement("span", { text: "-" }),
            createElement("span", { text: dateString }),
            createElement("span", {
                className: `px-2 py-0.5 rounded-full text-[10px] tracking-wide uppercase ${proposalBadgeClass(prop.status)}`,
                text: prop.status,
            }),
        ]),
    ]);

    item.appendChild(body);
    const actions = renderProposalActions(prop, isLocked);
    if (actions.childElementCount > 0) item.appendChild(actions);
    return item;
}

async function fetchAndRenderProposals(lineId) {
    const listContainer = byId("proposals-list");
    const titleCount = byId("proposals-title-count");
    const { data: proposals, error } = await supabaseClient
        .from("proposals")
        .select("id, line_id, user_id, msgstr, status, created_at, language, profiles ( username, role )")
        .eq("line_id", lineId)
        .eq("language", currentLanguage)
        .order("created_at", { ascending: false });

    if (error) {
        appendMessage(listContainer, "Failed to load proposals.", "text-xs text-red-500");
        return;
    }

    const isLocked = activeLineRef?.locked_languages?.includes(currentLanguage) || false;
    const hasApproved = proposals.some((proposal) => proposal.status === "approved");
    const myPending = proposals.find((proposal) => proposal.user_id === currentUser.id && proposal.status === "pending");
    syncPendingProposalActions(myPending, isLocked);

    const proposalsToRender = isLocked && hasApproved
        ? proposals.filter((proposal) => proposal.status === "approved")
        : proposals;

    setText(titleCount, isLocked && hasApproved ? "Approved Translation (Locked)" : `Active Proposals (${proposals.length})`);
    clearElement(listContainer);

    if (proposalsToRender.length === 0) {
        appendMessage(listContainer, "No alternative proposals registered yet.");
        return;
    }

    proposalsToRender.forEach((proposal) => listContainer.appendChild(renderProposalItem(proposal, isLocked)));
}

async function handleDeleteProposal() {
    if (!userPendingProposalRef) return;

    const confirmed = confirm("Do you really want to delete your pending proposal?");
    if (!confirmed) return;

    const deleteBtn = byId("delete-proposal-btn");
    const submitBtn = byId("submit-proposal-btn");
    if (deleteBtn) deleteBtn.disabled = true;
    if (submitBtn) submitBtn.disabled = true;

    const { error } = await supabaseClient.from("proposals").delete().eq("id", userPendingProposalRef.id);
    if (error) {
        showToast("Error", `Unable to delete the proposal: ${error.message}`, "error");
        if (deleteBtn) deleteBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    showToast("Success", "Your proposal has been deleted.", "success");
    byId("proposal-textarea").value = "";
    await refreshCarouselWorkspace();
}

async function handleProposalSubmission(event) {
    event.preventDefault();
    if (!activeLineRef) return;
    if (activeLineRef.locked_languages?.includes(currentLanguage)) return;

    const submitBtn = byId("submit-proposal-btn");
    if (submitBtn.disabled) return;

    const textInput = byId("proposal-textarea");
    const targetStringValue = textInput.value.trim();
    if (!targetStringValue) {
        showToast("Error", "Translation proposal cannot be empty.", "error");
        return;
    }

    submitBtn.disabled = true;

    if (userPendingProposalRef) {
        const { error } = await supabaseClient
            .from("proposals")
            .update({ msgstr: targetStringValue })
            .eq("id", userPendingProposalRef.id);

        if (error) {
            showToast("Update Failed", error.message, "error");
            submitBtn.disabled = false;
            return;
        }

        showToast("Success", "Translation proposal updated.", "success");
        await refreshCarouselWorkspace();
        return;
    }

    const { error } = await supabaseClient.from("proposals").insert({
        line_id: activeLineRef.id,
        user_id: currentUser.id,
        msgstr: targetStringValue,
        language: currentLanguage,
        status: "pending",
    });

    if (error) {
        showToast("Submission Failed", error.message, "error");
        submitBtn.disabled = false;
        return;
    }

    showToast("Success", "Translation proposal submitted.", "success");
    textInput.value = "";
    await refreshCarouselWorkspace();
}

async function alterProposalStatus(proposalId, newStatus) {
    if (!activeLineRef || !isReviewerRole(userProfile?.role)) return;
    const id = requireRecordId(proposalId, "Proposal id");
    if (!["approved", "rejected"].includes(newStatus)) return;

    try {
        if (newStatus === "approved") {
            await supabaseClient
                .from("proposals")
                .update({ status: "rejected" })
                .eq("line_id", activeLineRef.id)
                .eq("language", currentLanguage)
                .neq("id", id);

            const currentLockedList = activeLineRef.locked_languages || [];
            if (!currentLockedList.includes(currentLanguage)) {
                await supabaseClient
                    .from("lines")
                    .update({ locked_languages: [...currentLockedList, currentLanguage] })
                    .eq("id", activeLineRef.id);
            }
        }

        const { error } = await supabaseClient.from("proposals").update({ status: newStatus }).eq("id", id);
        if (error) throw error;

        showToast("Status Updated", `Proposal marked as: ${newStatus}.`, "success");
        await refreshCarouselWorkspace();
        await updateMetricsTracker();
    } catch (error) {
        showToast("Action Failed", error.message, "error");
    }
}

function navigateLine(direction) {
    const nextSequence = currentSequenceOrder + direction;
    if (nextSequence >= 1 && nextSequence <= totalLinesCount) {
        currentSequenceOrder = nextSequence;
        void refreshCarouselWorkspace();
    }
}

function handleDirectLineJump() {
    const targetValue = normalizePositiveInteger(byId("direct-line-input").value, currentSequenceOrder);

    if (targetValue < 1 || targetValue > totalLinesCount) {
        showToast("Navigation Error", `Enter a line number between 1 and ${totalLinesCount}.`, "error");
        byId("direct-line-input").value = currentSequenceOrder;
        return;
    }

    currentSequenceOrder = targetValue;
    void refreshCarouselWorkspace();
}

async function jumpToNextUntranslated() {
    if (totalLinesCount === 0) return;

    showToast("Scanning", "Looking for the next untranslated line...", "info");

    const { data: targetSequence, error } = await supabaseClient.rpc("get_next_untranslated_line", {
        p_project_id: projectId,
        p_current_sequence: currentSequenceOrder,
        p_total_lines: totalLinesCount,
        p_language: currentLanguage,
    });

    if (error) {
        showToast("Error", "Could not scan for untranslated lines.", "error");
        return;
    }

    if (targetSequence !== -1) {
        currentSequenceOrder = targetSequence;
        await refreshCarouselWorkspace();
    } else {
        showToast("All Done!", "All lines have approved translations.", "success");
    }
}

async function handleLanguageChange() {
    const selectedLang = normalizeLanguage(byId("target-language-select").value, currentLanguage);

    if (selectedLang === projectSourceLanguage) {
        showToast("Invalid Selection", "You cannot translate a language into itself.", "error");
        byId("target-language-select").value = currentLanguage;
        return;
    }

    currentLanguage = selectedLang;
    if (activeLineRef) {
        await refreshCarouselWorkspace();
        await updateMetricsTracker();
    }
}

function handleClick(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;

    const { action, direction, proposalId, status } = actionElement.dataset;
    if (action === "jump-line") handleDirectLineJump();
    if (action === "navigate-line") navigateLine(Number.parseInt(direction, 10));
    if (action === "next-untranslated") void jumpToNextUntranslated();
    if (action === "toggle-lock") void toggleLineLock();
    if (action === "delete-proposal") void handleDeleteProposal();
    if (action === "set-proposal-status") void alterProposalStatus(proposalId, status);
}

function bindEvents() {
    document.addEventListener("click", handleClick);
    byId("target-language-select").addEventListener("change", () => void handleLanguageChange());
    byId("proposal-form").addEventListener("submit", handleProposalSubmission);
    document.addEventListener("keydown", (event) => {
        if (event.target.id === "proposal-textarea" && event.ctrlKey && event.key === "Enter") {
            event.preventDefault();
            void handleProposalSubmission(event);
        }
    });
}

function subscribeToRealtime() {
    supabaseClient
        .channel("schema-db-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "proposals" }, () => {
            if (activeLineRef) void fetchAndRenderProposals(activeLineRef.id);
            void updateMetricsTracker();
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lines" }, (payload) => {
            if (activeLineRef && payload.new.id === activeLineRef.id) {
                void refreshCarouselWorkspace();
            }
        })
        .subscribe();
}

async function initWorkspace() {
    const params = new URLSearchParams(window.location.search);
    try {
        projectId = requireRecordId(params.get("project_id"), "Project id");
    } catch {
        alert("Missing project parameters. Returning to dashboard.");
        window.location.href = "index.html";
        return;
    }

    currentSequenceOrder = normalizePositiveInteger(params.get("line"), 1);
    currentLanguage = normalizeLanguage(params.get("lang"), "FR");

    const session = await requireSession();
    if (!session) return;

    currentUser = session.user;
    bindEvents();
    await fetchProfileAndPermissions();

    const projectExists = await fetchProjectMetadata();
    if (!projectExists) return;

    if (currentLanguage === projectSourceLanguage) {
        currentLanguage = firstLanguageExcept(projectSourceLanguage);
        updateURLParams();
    }

    configureLanguageSelect(byId("target-language-select"), {
        excludedLanguage: projectSourceLanguage,
        selectedLanguage: currentLanguage,
    });

    await loadProjectSequenceMatrix();
    subscribeToRealtime();
}

window.addEventListener("DOMContentLoaded", () => {
    void initWorkspace();
});
