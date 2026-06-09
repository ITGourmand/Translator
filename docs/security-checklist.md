# Supabase Security Checklist

This repo now avoids trusting the browser for authorization, but the database still needs server-side policy checks.

- Enable RLS on `profiles`, `projects`, `lines`, `proposals`, `imports`, and promotion-key tables.
- Ensure translators can only read projects/lines they are allowed to access and can only insert/update/delete their own pending proposals.
- Ensure only `reviewer`, `admin`, or `superadmin` can approve/reject proposals or lock lines.
- Ensure only `admin` and `superadmin` can create/delete projects, create imports, roll back imports, and generate promotion keys.
- Ensure storage policies for `po-files` restrict users to paths under their own auth user id.
- Ensure storage policies for `avatars` restrict writes to the current user's folder and validate image MIME/size where possible.
- Keep `SUPABASE_SERVICE_ROLE_KEY` only in Supabase Edge Function secrets, never in browser code.
