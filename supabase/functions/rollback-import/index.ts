import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CORS_HEADERS, createAdminClient, jsonResponse, requireAdminUser } from "../_shared/auth.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    try {
        const supabaseAdmin = createAdminClient();
        await requireAdminUser(req, supabaseAdmin);

        const { importId } = await req.json();
        if (!importId) throw new Error("Missing required parameter: importId.");

        const { data: importRow, error: fetchError } = await supabaseAdmin
            .from("imports")
            .select("storage_path")
            .eq("id", importId)
            .maybeSingle();
        if (fetchError) throw new Error(`Import lookup failed: ${fetchError.message}`);

        if (importRow?.storage_path) {
            const { error: removeError } = await supabaseAdmin.storage
                .from("po-files")
                .remove([importRow.storage_path]);
            if (removeError) {
                console.warn("[rollback-import] Storage cleanup warning:", removeError.message);
            }
        }

        const { error: rollbackError } = await supabaseAdmin.rpc("rollback_import", {
            p_import_id: importId,
        });
        if (rollbackError) throw new Error(`Rollback failed: ${rollbackError.message}`);

        return jsonResponse({ success: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith("Missing Authorization") || message.startsWith("Unauthorized")
            ? 401
            : message.startsWith("Forbidden")
            ? 403
            : 400;
        console.error("[rollback-import] Error:", message);
        return jsonResponse({ error: message }, status);
    }
});
