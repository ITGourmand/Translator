import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parsePoSourceLines } from "../_shared/po-parser.ts";

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
        const { filePath, projectId } = await req.json();
        if (!filePath || !projectId) throw new Error("Missing required parameters: filePath, projectId.");

        // 4. Download the source PO file from storage.
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
            .from("po-files")
            .download(filePath);
        if (downloadError || !fileData) throw new Error("Source PO file could not be downloaded.");

        // 5. Parse the PO content into source lines.
        const textContent = await fileData.text();
        const parsedLines = parsePoSourceLines(textContent);

        const linesToInsert = parsedLines.map((line) => ({
            project_id: projectId,
            msgid: line.msgid,
            sequence_order: line.sequence_order,
        }));

        // 6. Insert lines in batches.
        if (linesToInsert.length > 0) {
            const BATCH_SIZE = 1000;
            for (let i = 0; i < linesToInsert.length; i += BATCH_SIZE) {
                const batch = linesToInsert.slice(i, i + BATCH_SIZE);
                const { error: insertError } = await supabaseAdmin.from("lines").insert(batch);
                if (insertError) throw new Error(`Line insertion failed: ${insertError.message}`);
            }
        }

        return jsonResponse({ success: true, totalImported: linesToInsert.length });
    } catch (err) {
        console.error("[parse-po-file] Error:", err.message);
        return jsonResponse({ error: err.message }, 400);
    }
});