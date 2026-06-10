import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildFirstNonEmptyTranslationMap, parsePoTranslations } from "../_shared/po-parser.ts";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
}

/** Normalize msgid by collapsing whitespace and trimming. */
function normalizeMsgid(msgid: string): string {
    return msgid
        .trim() // Remove leading/trailing whitespace
        .replace(/\s+/g, ' '); // Collapse multiple spaces into one
}

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    try {
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { persistSession: false } },
        );

        // 1. Verify the user's JWT.
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return jsonResponse({ error: "Unauthorized: Invalid token" }, 401);

        // 2. Verify the user has admin privileges.
        const { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("role")
            .eq("id", user.id)
            .single();

        if (profileError || !profile || !["admin", "superadmin"].includes(profile.role)) {
            return jsonResponse({ error: "Forbidden: Insufficient privileges" }, 403);
        }

        // 3. Parse request parameters.
        const { filePath, projectId, importId, language } = await req.json();
        if (!filePath || !projectId || !importId || !language) {
            throw new Error("Missing required parameters: filePath, projectId, importId, language.");
        }

        // 4. Download the imported PO file from storage.
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
            .from("po-files")
            .download(filePath);
        if (downloadError || !fileData) throw new Error("Imported PO file could not be downloaded.");

        // 5. Parse the PO content into msgid/msgstr pairs.
        const textContent = await fileData.text();
        const entries = parsePoTranslations(textContent);

        const {
            translations,
            skippedDuplicateMsgids,
            skippedEmpty,
        } = buildFirstNonEmptyTranslationMap(entries);

        // 6. Load the project's source lines from the database.
        const dbLines: any[] = [];
        let start = 0;
        const PAGE_SIZE = 1000;
        while (true) {
            const { data, error: dbLinesError } = await supabaseAdmin
                .from("lines")
                .select("id, msgid")
                .eq("project_id", projectId)
                .order("sequence_order", { ascending: true })
                .range(start, start + PAGE_SIZE - 1);

            if (dbLinesError) {
                throw new Error(`Failed to fetch project lines: ${dbLinesError.message}`);
            }
            if (!data || data.length === 0) break;
            dbLines.push(...data);
            if (data.length < PAGE_SIZE) break;
            start += PAGE_SIZE;
        }

        // Build a msgid → line ID(s) lookup map.
        const msgidMap = new Map<string, string[]>();
        for (const line of dbLines) {
            const normalizedMsgid = normalizeMsgid(line.msgid);
            const ids = msgidMap.get(normalizedMsgid) ?? [];
            ids.push(String(line.id));
            msgidMap.set(normalizedMsgid, ids);
        }

        // 7. Fetch the set of line IDs that already have an approved proposal.
        const approvedLineIds = new Set<string>();
        let startProp = 0;
        while (true) {
            const { data: approvedProposals, error: approvedError } = await supabaseAdmin
                .from("proposals")
                .select("line_id, lines!inner(project_id)")
                .eq("language", language)
                .eq("status", "approved")
                .eq("lines.project_id", projectId)
                .range(startProp, startProp + PAGE_SIZE - 1);

            if (approvedError) {
                throw new Error(`Failed to fetch approved proposals: ${approvedError.message}`);
            }
            if (!approvedProposals || approvedProposals.length === 0) break;
            approvedProposals.forEach((prop) => approvedLineIds.add(String(prop.line_id)));
            if (approvedProposals.length < PAGE_SIZE) break;
            startProp += PAGE_SIZE;
        }

        // 8. Build the list of proposals to insert, skipping unmatched and already-approved lines.
        const proposalsToInsert: object[] = [];
        const lineIdsToPropagate: string[] = [];
        let skippedApproved = 0;
        let skippedMissingMsgid = 0;

        for (const [msgid, msgstr] of translations.entries()) {
            const targetLineIds = msgidMap.get(msgid);
            if (!targetLineIds || targetLineIds.length === 0) {
                skippedMissingMsgid++;
                continue;
            }

            for (const lineId of targetLineIds) {
                if (approvedLineIds.has(lineId)) {
                    skippedApproved++;
                    continue;
                }

                proposalsToInsert.push({
                    line_id: lineId,
                    user_id: user.id,
                    msgstr,
                    language,
                    status: "approved",
                    import_id: importId,
                });
                approvedLineIds.add(lineId);
                lineIdsToPropagate.push(lineId);
            }
        }

        // 9. Insert proposals in batches.
        if (proposalsToInsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < proposalsToInsert.length; i += BATCH_SIZE) {
                const batch = proposalsToInsert.slice(i, i + BATCH_SIZE);
                const { error: insertError } = await supabaseAdmin.from("proposals").insert(batch);
                if (insertError) throw new Error(`Proposal insertion failed: ${insertError.message}`);
            }

            // 10. Propagate and lock lines in bulk via database function.
            const { error: propagateError } = await supabaseAdmin.rpc("propagate_bulk_import_by_lines", {
                p_project_id: projectId,
                p_import_id: importId,
                p_line_ids: lineIdsToPropagate,
                p_language: language,
            });

            if (propagateError) throw new Error(`Proposal propagation failed: ${propagateError.message}`);
        }

        const stats = {
            totalEntries: entries.length,
            totalImported: proposalsToInsert.length,
            skippedApproved,
            skippedDuplicateMsgids,
            skippedMissingMsgid,
            skippedEmpty,
        };

        const { error: updateStatsError } = await supabaseAdmin
            .from("imports")
            .update({
                total_entries: stats.totalEntries,
                imported_count: stats.totalImported,
                skipped_approved_count: stats.skippedApproved,
                skipped_duplicate_msgid_count: stats.skippedDuplicateMsgids,
                skipped_missing_msgid_count: stats.skippedMissingMsgid,
                skipped_empty_count: stats.skippedEmpty,
            })
            .eq("id", importId)
            .eq("project_id", projectId);

        if (updateStatsError) throw new Error(`Import stats update failed: ${updateStatsError.message}`);

        return jsonResponse({ success: true, ...stats });
    } catch (err) {
        console.error("[import-po-file] Error:", err.message);
        return jsonResponse({ error: err.message }, 400);
    }
});
