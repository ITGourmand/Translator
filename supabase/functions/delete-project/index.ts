import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { CORS_HEADERS, createAdminClient, jsonResponse, requireAdminUser } from "../_shared/auth.ts";

serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

    try {
        const supabaseAdmin = createAdminClient();
        await requireAdminUser(req, supabaseAdmin);

        const { projectId } = await req.json();
        if (!projectId) throw new Error("Missing required parameter: projectId.");

        const { data: project, error: projectError } = await supabaseAdmin
            .from("projects")
            .select("po_storage_path")
            .eq("id", projectId)
            .maybeSingle();
        if (projectError) throw new Error(`Project lookup failed: ${projectError.message}`);

        const { data: imports, error: importsError } = await supabaseAdmin
            .from("imports")
            .select("storage_path")
            .eq("project_id", projectId);
        if (importsError) throw new Error(`Import lookup failed: ${importsError.message}`);

        const paths = [
            `projects/${projectId}/source.po`,
            project?.po_storage_path,
            ...(imports || []).map((importRow) => importRow.storage_path),
        ].filter((path): path is string => Boolean(path));
        const uniquePaths = [...new Set(paths)];

        if (uniquePaths.length > 0) {
            const { error: removeError } = await supabaseAdmin.storage
                .from("po-files")
                .remove(uniquePaths);
            if (removeError) {
                console.warn("[delete-project] Storage cleanup warning:", removeError.message);
            }
        }

        const { error: deleteError } = await supabaseAdmin.rpc("delete_project_cleanup", {
            p_project_id: projectId,
        });
        if (deleteError) throw new Error(`Project deletion failed: ${deleteError.message}`);

        return jsonResponse({ success: true, removedFiles: uniquePaths.length });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith("Missing Authorization") || message.startsWith("Unauthorized")
            ? 401
            : message.startsWith("Forbidden")
            ? 403
            : 400;
        console.error("[delete-project] Error:", message);
        return jsonResponse({ error: message }, status);
    }
});
