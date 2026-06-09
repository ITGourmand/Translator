import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parsePoTranslations } from "../_shared/po-parser.ts";

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

        // 6. Load the project's source lines from the database.
        const { data: dbLines, error: dbLinesError } = await supabaseAdmin
            .from("lines")
            .select("id, msgid")
            .eq("project_id", projectId);

        if (dbLinesError || !dbLines) {
            throw new Error(`Failed to fetch project lines: ${dbLinesError?.message}`);
        }

        // Build a msgid → line ID(s) lookup map.
        const msgidMap = new Map<string, number[]>();
        for (const line of dbLines) {
            const ids = msgidMap.get(line.msgid) ?? [];
            ids.push(line.id);
            msgidMap.set(line.msgid, ids);
        }

        // 7. Fetch the set of line IDs that already have an approved proposal.
        const dbLineIds = dbLines.map((line) => line.id);
        const approvedLineIds = new Set<number>();

        if (dbLineIds.length > 0) {
            const { data: approvedProposals, error: approvedError } = await supabaseAdmin
                .from("proposals")
                .select("line_id")
                .eq("language", language)
                .eq("status", "approved")
                .in("line_id", dbLineIds);

            if (approvedError) {
                throw new Error(`Failed to fetch approved proposals: ${approvedError.message}`);
            }
            approvedProposals?.forEach((prop) => approvedLineIds.add(Number(prop.line_id)));
        }

        // 8. Build the list of proposals to insert, skipping empty and already-approved lines.
        const proposalsToInsert: object[] = [];
        const lineIdsToPropagate: number[] = [];
        let skippedApproved = 0;

        for (const entry of entries) {
            const cleanMsgstr = entry.msgstr.trim();
            if (!cleanMsgstr) continue; // Skip untranslated entries.

            const targetLineIds = msgidMap.get(entry.msgid);
            if (!targetLineIds || targetLineIds.length === 0) continue; // No matching source line.

            const mainLineId = targetLineIds[0];
            if (approvedLineIds.has(Number(mainLineId))) {
                skippedApproved++;
                continue;
            }

            proposalsToInsert.push({
                line_id: mainLineId,
                user_id: user.id,
                msgstr: entry.msgstr,
                language,
                status: "approved",
                import_id: importId,
            });
            lineIdsToPropagate.push(mainLineId);
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

        return jsonResponse({ success: true, totalImported: proposalsToInsert.length, skippedApproved });
    } catch (err) {
        console.error("[import-po-file] Error:", err.message);
        return jsonResponse({ error: err.message }, 400);
    }
});
