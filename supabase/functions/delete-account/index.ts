import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
            { auth: { persistSession: false } },
        );

        // 1. Verify the user's JWT.
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

        const token = authHeader.replace("Bearer ", "");
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return jsonResponse({ error: "Unauthorized: Invalid token" }, 401);

        // 2. Permanently delete the user from Supabase Auth.
        // Cascade rules in the database handle the removal of related profile data.
        const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
        if (deleteError) return jsonResponse({ error: deleteError.message }, 400);

        return jsonResponse({ success: true });
    } catch (err) {
        console.error("[delete-account] Error:", err.message);
        return jsonResponse({ error: err.message }, 500);
    }
});