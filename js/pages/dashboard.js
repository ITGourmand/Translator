import { ALLOWED_LANGUAGES, LANGUAGE_LABELS, ROLE_BADGE_BASE, isAdminRole } from "../core/constants.js";
import {
    appendMessage,
    byId,
    clearElement,
    createElement,
    createOption,
    createSvgIcon,
    setButtonBusy,
    setClass,
    setText,
} from "../core/dom.js";
import { parsePoSourceLines, replacePoMsgstrs } from "../core/po.js";
import { fetchCurrentProfile, logout, requireSession, supabaseClient } from "../core/supabase.js";
import { showToast } from "../core/toast.js";
import {
    assertAllowedLanguage,
    configureLanguageSelect,
    firstLanguageExcept,
    languageLabel,
    normalizeLanguage,
    requireRecordId,
    sanitizeFileBaseName,
    validatePoFile,
} from "../core/validation.js";

let currentUser = null;
let currentUserProfile = null;

function renderRoleBadge(profile) {
    const badge = byId("user-role-badge");
    setText(badge, profile.role);

    if (isAdminRole(profile.role)) {
        setClass(badge, `${ROLE_BADGE_BASE} px-3 py-1 bg-brandCyan-100 text-brandCyan-700 border border-brandCyan-200`);
        byId("admin-panel").classList.remove("hidden");
        return;
    }

    if (profile.role === "reviewer") {
        setClass(badge, `${ROLE_BADGE_BASE} px-3 py-1 bg-emerald-100 text-emerald-800 border border-emerald-200`);
        return;
    }

    setClass(badge, `${ROLE_BADGE_BASE} px-3 py-1 bg-stone-100 text-stone-600 border border-stone-200`);
}

async function fetchUserProfile() {
    const profile = await fetchCurrentProfile(currentUser.id);
    if (!profile) {
        showToast("Session Error", "Could not synchronize account profile credentials.", "error");
        return null;
    }
    currentUserProfile = profile;
    setText(byId("welcome-username"), profile.username);
    renderRoleBadge(profile);
    return profile;
}

function createLanguageSelect(project) {
    const sourceLanguage = normalizeLanguage(project.source_language, "");
    const selectedLanguage = firstLanguageExcept(sourceLanguage);
    const select = createElement("select", {
        id: `lang-select-${project.id}`,
        className: "text-xs border border-stone-200 rounded px-1.5 py-0.5 bg-white font-medium text-stone-700 focus:outline-none focus:ring-1 focus:ring-brandCyan-500",
        dataset: { languageSelect: project.id },
    });

    ALLOWED_LANGUAGES.forEach((language) => {
        const option = createOption(language, languageLabel(language), language === selectedLanguage);
        option.disabled = language === sourceLanguage;
        option.hidden = language === sourceLanguage;
        select.appendChild(option);
    });

    return select;
}

function createAdminControls(project) {
    const container = createElement("div", {
        className: "mt-3 pt-3 border-t border-stone-100 flex flex-col gap-2 bg-stone-50 p-2.5 rounded-lg",
    });

    const selectRow = createElement("div", { className: "flex items-center justify-between gap-2" }, [
        createElement("label", { className: "text-[10px] font-bold text-stone-500 uppercase tracking-wider", text: "Target Language:" }),
        createLanguageSelect(project),
    ]);

    const deleteButton = createElement("button", {
        type: "button",
        className: "inline-flex items-center bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-semibold text-[11px] px-2.5 py-1 rounded-md transition",
        text: "Delete",
        dataset: { action: "delete-project", projectId: project.id },
    });

    const importButton = createElement("button", {
        type: "button",
        className: "inline-flex items-center bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300 font-semibold text-[11px] px-2.5 py-1 rounded-md transition",
        text: "Import Variant",
        dataset: {
            action: "open-import",
            projectId: project.id,
            projectName: project.name || "",
            sourceLanguage: project.source_language || "",
        },
    });

    const downloadButton = createElement("button", {
        type: "button",
        className: "inline-flex items-center gap-1 bg-brandCyan-600 hover:bg-brandCyan-700 text-white font-semibold text-[11px] px-2.5 py-1 rounded-md shadow-xs transition",
        dataset: { action: "download-project", projectId: project.id, projectName: project.name || "" },
    }, [
        createSvgIcon("M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4", "h-3 w-3"),
        document.createTextNode("Download .PO"),
    ]);

    const actions = createElement("div", { className: "flex gap-2 justify-between mt-1" }, [
        deleteButton,
        createElement("div", { className: "flex gap-1.5" }, [importButton, downloadButton]),
    ]);

    container.append(selectRow, actions);
    return container;
}

function createProjectCard(project) {
    const creationDate = new Date(project.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });

    const card = createElement("div", {
        className: "bg-white p-5 rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition flex flex-col justify-between relative overflow-hidden",
    });

    const header = createElement("div", {}, [
        createElement("h3", { className: "text-base font-bold text-stone-900 truncate mb-1", text: project.name || "Untitled project" }),
        createElement("p", { className: "text-stone-400 text-xs flex items-center gap-1 mb-2" }, [
            createSvgIcon("M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z", "h-3.5 w-3.5"),
            document.createTextNode(`Created on ${creationDate}`),
        ]),
    ]);

    card.appendChild(header);

    if (isAdminRole(currentUserProfile?.role)) {
        card.appendChild(createAdminControls(project));
    }

    const params = new URLSearchParams({ project_id: String(project.id) });
    const openLink = createElement("a", {
        href: `workspace.html?${params.toString()}`,
        className: "inline-flex items-center gap-1.5 bg-brandGreen-700 hover:bg-brandGreen-800 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-sm transition w-full justify-center",
    }, [
        document.createTextNode("Open Focus Hub"),
        createSvgIcon("M9 5l7 7-7 7", "h-3 w-3"),
    ]);

    card.appendChild(createElement("div", { className: "pt-3 mt-2 border-t border-stone-100 flex justify-end" }, [openLink]));
    return card;
}

async function fetchAndRenderProjects() {
    const grid = byId("project-grid");
    const countBadge = byId("project-count");

    const { data: projects, error } = await supabaseClient
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        showToast("Fetch Failure", "Failed to retrieve project listings.", "error");
        return;
    }

    clearElement(grid);
    setText(countBadge, projects.length);

    if (projects.length === 0) {
        grid.appendChild(createElement("div", {
            className: "col-span-full bg-white p-8 border border-dashed border-stone-200 text-center rounded-xl",
        }, [
            createElement("p", {
                className: "text-stone-400 text-sm font-medium",
                text: "No localization projects are active at this moment.",
            }),
        ]));
        return;
    }

    projects.forEach((project) => grid.appendChild(createProjectCard(project)));
}

function openImportPanel(projectId, sourceLanguage) {
    byId("import-project-id").value = requireRecordId(projectId, "Project id");
    const panel = byId("import-translation-panel");
    panel.classList.remove("hidden");
    panel.scrollIntoView({ behavior: "smooth" });

    configureLanguageSelect(byId("import-lang-select"), {
        excludedLanguage: sourceLanguage,
        selectedLanguage: byId("import-lang-select").value,
    });

    void fetchImportHistory(projectId);
}

function closeImportPanel() {
    byId("import-translation-panel").classList.add("hidden");
}

function renderImportItem(importRow) {
    const date = new Date(importRow.created_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
    const stats = [
        `entries ${importRow.total_entries || 0}`,
        `imported ${importRow.imported_count || 0}`,
        `approved skips ${importRow.skipped_approved_count || 0}`,
        `duplicate skips ${importRow.skipped_duplicate_msgid_count || 0}`,
        `missing skips ${importRow.skipped_missing_msgid_count || 0}`,
        `empty skips ${importRow.skipped_empty_count || 0}`,
    ].join(" · ");

    return createElement("div", {
        className: "flex justify-between items-center bg-stone-50 p-2.5 rounded-xl border border-stone-200/60 shadow-2xs",
    }, [
        createElement("div", {}, [
            createElement("span", { className: "font-bold text-stone-700", text: importRow.file_name || "Unknown file" }),
            document.createTextNode(" "),
            createElement("span", { className: "text-stone-400 text-[11px] font-medium", text: `(${importRow.language}) - Ingested on ${date}` }),
            createElement("div", { className: "text-stone-500 text-[10px] mt-1", text: stats }),
        ]),
        createElement("button", {
            type: "button",
            className: "text-red-600 hover:text-red-700 font-bold bg-red-50 px-2.5 py-1 rounded-lg border border-red-200/80 hover:bg-red-100 transition text-[10px] tracking-wide uppercase",
            text: "Rollback Import",
            dataset: { action: "rollback-import", importId: importRow.id },
        }),
    ]);
}

async function fetchImportHistory(projectId) {
    const historyContainer = byId("imports-history-list");
    appendMessage(historyContainer, "Querying system import logs...");

    const { data: imports, error } = await supabaseClient
        .from("imports")
        .select("*")
        .eq("project_id", requireRecordId(projectId, "Project id"))
        .order("created_at", { ascending: false });

    if (error || !imports || imports.length === 0) {
        appendMessage(historyContainer, "No variant imports found for this project.");
        return;
    }

    clearElement(historyContainer);
    imports.forEach((importRow) => historyContainer.appendChild(renderImportItem(importRow)));
}

async function handleRollbackImport(importId) {
    const id = requireRecordId(importId, "Import id");
    const confirmRollback = confirm("Are you sure you want to reverse this import? Approved proposals from this batch will be removed.");
    if (!confirmRollback) return;

    showToast("Reversing", "Purging batch translations...", "info");

    try {
        const { error } = await supabaseClient.functions.invoke("rollback-import", {
            body: { importId: id },
        });
        if (error) throw error;

        showToast("Success", "Import batch purged successfully.", "success");
        await fetchImportHistory(byId("import-project-id").value);
    } catch (error) {
        showToast("Rollback Failed", error.message, "error");
    }
}

async function handleImportPo(event) {
    event.preventDefault();
    const submitBtn = byId("import-submit-btn");
    const projectId = requireRecordId(byId("import-project-id").value, "Project id");
    const targetLang = assertAllowedLanguage(byId("import-lang-select").value);
    const fileInput = byId("import-file-input");
    const file = validatePoFile(fileInput.files?.[0]);
    let importRow = null;
    let filePath = "";

    setButtonBusy(submitBtn, true, "Merge Translation Matrix", "Registering import...");

    try {
        const { data, error: importError } = await supabaseClient
            .from("imports")
            .insert({
                project_id: projectId,
                user_id: currentUser.id,
                file_name: file.name,
                language: targetLang,
                is_variant: true
            })
            .select()
            .single();

        if (importError) throw importError;
        importRow = data;

        setButtonBusy(submitBtn, true, "Merge Translation Matrix", "Uploading .po file...");
        filePath = `projects/${projectId}/variants/${importRow.id}.po`;

        const { error: uploadError } = await supabaseClient.storage.from("po-files").upload(filePath, file);
        if (uploadError) throw uploadError;

        // update import with storage path
        const { error: updateError } = await supabaseClient
            .from("imports")
            .update({ storage_path: filePath })
            .eq("id", importRow.id);
        if (updateError) throw updateError;

        setButtonBusy(submitBtn, true, "Merge Translation Matrix", "Merging translations...");
        const { data: functionData, error: functionError } = await supabaseClient.functions.invoke("import-po-file", {
            body: { filePath, projectId, importId: importRow.id, language: targetLang },
        });

        if (functionError) throw functionError;

        showToast(
            "Success",
            `Variant matched. Imported ${functionData.totalImported} translations; skipped ${functionData.skippedApproved || 0} approved, ${functionData.skippedDuplicateMsgids || 0} duplicate msgids.`,
            "success",
        );
        fileInput.value = "";
        await fetchImportHistory(projectId);
    } catch (error) {
        showToast("Import Failed", error.message, "error");
        if (importRow?.id) {
            const { error: rollbackError } = await supabaseClient.functions.invoke("rollback-import", {
                body: { importId: importRow.id },
            });
            if (rollbackError && filePath) {
                await supabaseClient.storage.from("po-files").remove([filePath]);
            }
        } else if (filePath) {
            await supabaseClient.storage.from("po-files").remove([filePath]);
        }
    } finally {
        setButtonBusy(submitBtn, false, "Merge Translation Matrix");
    }
}

async function handleDeleteProject(projectId) {
    const id = requireRecordId(projectId, "Project id");
    const confirmation = confirm("Are you absolutely sure you want to delete this project? This cannot be undone.");
    if (!confirmation) return;

    showToast("Processing", "Deleting project...", "info");

    const { error } = await supabaseClient.functions.invoke("delete-project", {
        body: { projectId: id },
    });
    if (error) {
        showToast("Deletion Failed", error.message, "error");
        return;
    }

    showToast("Success", "Project deleted successfully.", "success");
    await fetchAndRenderProjects();
}

async function downloadTranslatedPoFile(projectId, projectName, targetLanguage) {
    const id = requireRecordId(projectId, "Project id");
    const language = assertAllowedLanguage(targetLanguage);
    showToast("Exporting", "Fetching source .po template and compiling translations...", "info");

    try {
        const { data: projectData, error: projectError } = await supabaseClient
            .from("projects")
            .select("po_storage_path")
            .eq("id", id)
            .single();
        if (projectError || !projectData || !projectData.po_storage_path) {
            throw new Error("Could not find the project's original PO file path.");
        }

        let lines = [];
        let start = 0;
        const PAGE_SIZE = 5000;
        while (true) {
            const { data, error: linesError } = await supabaseClient
                .from("lines")
                .select("id, msgid, sequence_order")
                .eq("project_id", id)
                .order("sequence_order", { ascending: true })
                .range(start, start + PAGE_SIZE - 1);
            if (linesError) throw linesError;
            if (!data || data.length === 0) break;
            lines = lines.concat(data);
            if (data.length < PAGE_SIZE) break;
            start += PAGE_SIZE;
        }

        if (!lines || lines.length === 0) throw new Error("This project has no source lines to export.");

        let approvedProposals = [];
        let startProp = 0;
        while (true) {
            const { data, error: approvedError } = await supabaseClient
                .from("proposals")
                .select("line_id, msgstr, lines!inner(project_id)")
                .eq("language", language)
                .eq("status", "approved")
                .eq("lines.project_id", id)
                .range(startProp, startProp + PAGE_SIZE - 1);
            if (approvedError) throw approvedError;
            if (!data || data.length === 0) break;
            approvedProposals = approvedProposals.concat(data);
            if (data.length < PAGE_SIZE) break;
            startProp += PAGE_SIZE;
        }

        const translationMap = new Map(approvedProposals.map((proposal) => [String(proposal.line_id), proposal.msgstr || ""]));
        const orderedTranslations = [];
        for (const line of lines) {
            const approvedText = translationMap.get(String(line.id));
            orderedTranslations.push(approvedText || "");
        }

        const { data: blob, error: downloadError } = await supabaseClient.storage
            .from("po-files")
            .download(projectData.po_storage_path);

        if (downloadError) throw downloadError;

        const originalPoText = await blob.text();
        const finalText = replacePoMsgstrs(originalPoText, orderedTranslations);
        const exportedLineCount = parsePoSourceLines(originalPoText).length;

        if (exportedLineCount !== lines.length) {
            showToast("Export Warning", "Template line count differs from database; export used database order.", "info");
        }

        const fileName = `${sanitizeFileBaseName(projectName)}_export_${language}.po`;
        const finalBlob = new Blob([finalText], { type: "text/plain;charset=utf-8" });
        const downloadUrl = URL.createObjectURL(finalBlob);
        const transientLink = createElement("a", { href: downloadUrl, attributes: { download: fileName } });

        document.body.appendChild(transientLink);
        transientLink.click();
        transientLink.remove();
        URL.revokeObjectURL(downloadUrl);

        showToast("Export Complete", `File saved as ${fileName}`, "success");
    } catch (error) {
        showToast("Export Failed", error.message, "error");
    }
}

function selectedDownloadLanguage(projectId) {
    const select = byId(`lang-select-${projectId}`);
    return normalizeLanguage(select?.value, "FR");
}

async function handleCreateProject(event) {
    event.preventDefault();

    const submitBtn = byId("upload-submit-btn");
    const projectNameInput = byId("project-name");
    const fileInput = byId("po-file-input");
    const file = validatePoFile(fileInput.files?.[0]);
    const projectName = projectNameInput.value.trim();
    const sourceLanguage = assertAllowedLanguage(byId("project-source-lang").value);
    let createdProject = null;
    let filePath = "";

    if (!projectName) {
        showToast("Validation Error", "Project name is required.", "error");
        return;
    }

    setButtonBusy(submitBtn, true, "Ingest & Create Project", "Creating project...");

    try {
        const { data: project, error: projectError } = await supabaseClient
            .from("projects")
            .insert([{ name: projectName, source_language: sourceLanguage }])
            .select()
            .single();

        if (projectError || !project) throw projectError || new Error("Project could not be created.");
        createdProject = project;

        setButtonBusy(submitBtn, true, "Ingest & Create Project", "Uploading .po file...");
        filePath = `projects/${project.id}/source.po`;

        const { error: uploadError } = await supabaseClient.storage.from("po-files").upload(filePath, file);
        if (uploadError) throw uploadError;

        // update project to store the po_storage_path
        const { error: updateError } = await supabaseClient
            .from("projects")
            .update({ po_storage_path: filePath })
            .eq("id", project.id);
        if (updateError) throw updateError;

        setButtonBusy(submitBtn, true, "Ingest & Create Project", "Parsing .po file...");
        const { data: functionData, error: functionError } = await supabaseClient.functions.invoke("parse-po-file", {
            body: { filePath, projectId: project.id },
        });

        if (functionError) throw functionError;

        showToast("Success!", `Project created with ${functionData.totalImported} source lines.`, "success");
        projectNameInput.value = "";
        fileInput.value = "";
        await fetchAndRenderProjects();
    } catch (error) {
        showToast("Project Creation Failed", error.message, "error");
        if (createdProject?.id) {
            await supabaseClient.functions.invoke("delete-project", {
                body: { projectId: createdProject.id },
            });
        } else if (filePath) {
            await supabaseClient.storage.from("po-files").remove([filePath]);
        }
    } finally {
        setButtonBusy(submitBtn, false, "Ingest & Create Project");
    }
}

function handleClick(event) {
    const actionElement = event.target.closest("[data-action]");
    if (!actionElement) return;

    const { action, projectId, projectName, sourceLanguage, importId } = actionElement.dataset;
    if (action === "logout") void logout();
    if (action === "close-import-panel") closeImportPanel();
    if (action === "open-import") openImportPanel(projectId, sourceLanguage);
    if (action === "delete-project") void handleDeleteProject(projectId);
    if (action === "rollback-import") void handleRollbackImport(importId);
    if (action === "download-project") {
        void downloadTranslatedPoFile(projectId, projectName, selectedDownloadLanguage(projectId));
    }
}

async function initDashboard() {
    const session = await requireSession();
    if (!session) return;

    currentUser = session.user;
    document.addEventListener("click", handleClick);
    byId("upload-po-form").addEventListener("submit", handleCreateProject);
    byId("import-po-form").addEventListener("submit", handleImportPo);

    await fetchUserProfile();
    await fetchAndRenderProjects();
}

window.addEventListener("DOMContentLoaded", () => {
    void initDashboard();
});
