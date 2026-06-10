


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."delete_project_cleanup"("p_project_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
    if not public.is_admin_or_service() then
        raise exception 'Forbidden: insufficient privileges';
    end if;

    -- Supprimer le projet (cascade va supprimer lines, imports, proposals).
    delete from public.projects
    where id = p_project_id;
end;
$$;


ALTER FUNCTION "public"."delete_project_cleanup"("p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_promotion_key"("p_role_to_grant" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_code text;
    v_caller_role text;
begin
    select role into v_caller_role
    from public.profiles
    where id = auth.uid();

    if v_caller_role not in ('admin', 'superadmin') then
        raise exception 'Forbidden: insufficient privileges';
    end if;

    if v_caller_role = 'admin' and p_role_to_grant <> 'reviewer' then
        raise exception 'Forbidden: admins can only generate reviewer keys';
    end if;

    if p_role_to_grant not in ('reviewer', 'admin') then
        raise exception 'Invalid role: %', p_role_to_grant;
    end if;

    v_code := encode(gen_random_bytes(16), 'hex');

    insert into public.promotion_keys (code, role_to_grant, created_by)
    values (v_code, p_role_to_grant, auth.uid());

    return v_code;
end;
$$;


ALTER FUNCTION "public"."generate_promotion_key"("p_role_to_grant" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_next_untranslated_line"("p_project_id" "uuid", "p_current_sequence" integer, "p_total_lines" integer, "p_language" "text") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_result integer;
begin
    select l.sequence_order into v_result
    from public.lines l
    where l.project_id = p_project_id
      and l.sequence_order > p_current_sequence
      and not exists (
          select 1 from public.proposals p
          where p.line_id = l.id
            and p.language = p_language
            and p.status = 'approved'
      )
    order by l.sequence_order asc
    limit 1;

    if v_result is not null then
        return v_result;
    end if;

    select l.sequence_order into v_result
    from public.lines l
    where l.project_id = p_project_id
      and l.sequence_order <= p_current_sequence
      and not exists (
          select 1 from public.proposals p
          where p.line_id = l.id
            and p.language = p_language
            and p.status = 'approved'
      )
    order by l.sequence_order asc
    limit 1;

    if v_result is not null then
        return v_result;
    end if;

    return -1;
end;
$$;


ALTER FUNCTION "public"."get_next_untranslated_line"("p_project_id" "uuid", "p_current_sequence" integer, "p_total_lines" integer, "p_language" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_deleted_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
    -- Supprime l'utilisateur de la table d'authentification interne de Supabase
    delete from auth.users where id = old.id;
    return old;
end;
$$;


ALTER FUNCTION "public"."handle_deleted_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
    insert into public.profiles (id, username, role, created_at, updated_at)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'username', ''),
        'translator',
        now(),
        now()
    );
    return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_or_service"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    select
        auth.role() = 'service_role'
        or exists (
            select 1
            from public.profiles
            where id = auth.uid()
              and role in ('admin', 'superadmin')
        );
$$;


ALTER FUNCTION "public"."is_admin_or_service"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propagate_bulk_import_by_lines"("p_project_id" "uuid", "p_import_id" "uuid", "p_line_ids" "uuid"[], "p_language" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
    if not public.is_admin_or_service() then
        raise exception 'Forbidden: insufficient privileges';
    end if;

    update public.lines
    set locked_languages = array_append(locked_languages, p_language)
    where id = any(p_line_ids)
      and project_id = p_project_id
      and not (locked_languages @> array[p_language]);
end;
$$;


ALTER FUNCTION "public"."propagate_bulk_import_by_lines"("p_project_id" "uuid", "p_import_id" "uuid", "p_line_ids" "uuid"[], "p_language" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_profile_role"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- On applique la sécurité SEULEMENT si la modification vient directement de l'API (Front-end)
    IF current_user = 'authenticated' THEN
        -- Si un utilisateur non-admin tente de modifier son propre rôle
        IF NEW.role IS DISTINCT FROM OLD.role AND (SELECT role FROM public.profiles WHERE id = auth.uid()) NOT IN ('admin', 'superadmin') THEN
            -- On force la conservation de l'ancien rôle
            NEW.role := OLD.role;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."protect_profile_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_promotion_key"("token_code" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_key record;
begin
    select * into v_key
    from public.promotion_keys
    where code = token_code
      and redeemed_by is null
      and is_used = false
    for update;

    if v_key is null then
        raise exception 'Invalid or already redeemed key';
    end if;

    update public.promotion_keys
    set redeemed_by = auth.uid(),
        redeemed_at = now(),
        is_used = true
    where code = token_code;

    update public.profiles
    set role = v_key.role_to_grant,
        updated_at = now()
    where id = auth.uid();

    return v_key.role_to_grant;
end;
$$;


ALTER FUNCTION "public"."redeem_promotion_key"("token_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_import"("p_import_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
    v_line_ids uuid[];
    v_language text;
    v_project_id uuid;
begin
    if not public.is_admin_or_service() then
        raise exception 'Forbidden: insufficient privileges';
    end if;

    -- Get affected lines and language/project
    select array_agg(distinct line_id), max(language), max(project_id)
    into v_line_ids, v_language, v_project_id
    from public.proposals p
    join public.lines l on l.id = p.line_id
    where p.import_id = p_import_id;

    -- Delete proposals from the import
    delete from public.proposals where import_id = p_import_id;

    -- Unlock language for lines that no longer have approved proposals
    if v_line_ids is not null then
        update public.lines l
        set locked_languages = array_remove(locked_languages, v_language)
        where id = any(v_line_ids)
          and project_id = v_project_id
          and not exists (
              select 1 from public.proposals p
              where p.line_id = l.id
                and p.language = v_language
                and p.status = 'approved'
          );
    end if;

    -- Delete the import record
    delete from public.imports where id = p_import_id;
end;
$$;


ALTER FUNCTION "public"."rollback_import"("p_import_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."imports" (
    "legacy_id" bigint,
    "legacy_project_id" bigint,
    "user_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "language" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_entries" integer DEFAULT 0 NOT NULL,
    "imported_count" integer DEFAULT 0 NOT NULL,
    "skipped_approved_count" integer DEFAULT 0 NOT NULL,
    "skipped_duplicate_msgid_count" integer DEFAULT 0 NOT NULL,
    "skipped_missing_msgid_count" integer DEFAULT 0 NOT NULL,
    "skipped_empty_count" integer DEFAULT 0 NOT NULL,
    "storage_path" "text",
    "is_variant" boolean DEFAULT false NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL
);


ALTER TABLE "public"."imports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lines" (
    "legacy_id" bigint,
    "legacy_project_id" bigint,
    "msgid" "text" NOT NULL,
    "sequence_order" integer NOT NULL,
    "locked_languages" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL
);


ALTER TABLE "public"."lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "role" "text" DEFAULT 'translator'::"text" NOT NULL,
    "avatar_url" "text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chaine_roles" CHECK (("role" = ANY (ARRAY['translator'::"text", 'reviewer'::"text", 'admin'::"text", 'superadmin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "legacy_id" bigint,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "source_language" character varying(5) DEFAULT 'EN'::character varying,
    "po_storage_path" "text",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotion_keys" (
    "code" "text" NOT NULL,
    "role_to_grant" "text" NOT NULL,
    "is_used" boolean DEFAULT false NOT NULL,
    "redeemed_by" "uuid",
    "redeemed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chaine_roles_cles" CHECK (("role_to_grant" = ANY (ARRAY['reviewer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."promotion_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proposals" (
    "legacy_id" bigint,
    "legacy_line_id" bigint,
    "user_id" "uuid" NOT NULL,
    "msgstr" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "language" "text" DEFAULT 'FR'::"text" NOT NULL,
    "legacy_import_id" bigint,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "line_id" "uuid" NOT NULL,
    "import_id" "uuid",
    CONSTRAINT "chaine_status" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."proposals" OWNER TO "postgres";


ALTER TABLE ONLY "public"."imports"
    ADD CONSTRAINT "imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lines"
    ADD CONSTRAINT "lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promotion_keys"
    ADD CONSTRAINT "promotion_keys_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "unique_user_line_language_approved" UNIQUE ("user_id", "line_id", "language");



CREATE INDEX "idx_imports_project_created_at" ON "public"."imports" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "idx_imports_project_id" ON "public"."imports" USING "btree" ("project_id");



CREATE INDEX "idx_lines_project_id" ON "public"."lines" USING "btree" ("project_id");



CREATE INDEX "idx_lines_project_msgid" ON "public"."lines" USING "btree" ("project_id", "msgid");



CREATE INDEX "idx_lines_project_sequence" ON "public"."lines" USING "btree" ("project_id", "sequence_order");



CREATE INDEX "idx_proposals_import_id" ON "public"."proposals" USING "btree" ("import_id");



CREATE INDEX "idx_proposals_language_status_line" ON "public"."proposals" USING "btree" ("language", "status", "line_id");



CREATE INDEX "idx_proposals_line_id" ON "public"."proposals" USING "btree" ("line_id");



CREATE INDEX "idx_proposals_line_language" ON "public"."proposals" USING "btree" ("line_id", "language");



CREATE UNIQUE INDEX "unique_pending_proposal_per_user" ON "public"."proposals" USING "btree" ("user_id", "line_id", "language") WHERE ("status" = 'pending'::"text");



CREATE OR REPLACE TRIGGER "before_profile_update" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_profile_role"();



ALTER TABLE ONLY "public"."imports"
    ADD CONSTRAINT "imports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."imports"
    ADD CONSTRAINT "imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."lines"
    ADD CONSTRAINT "lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotion_keys"
    ADD CONSTRAINT "promotion_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotion_keys"
    ADD CONSTRAINT "promotion_keys_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "public"."lines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."proposals"
    ADD CONSTRAINT "proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete imports" ON "public"."imports" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can delete projects" ON "public"."projects" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can insert imports" ON "public"."imports" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can insert lines" ON "public"."lines" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can insert projects" ON "public"."projects" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can manage promotion keys" ON "public"."promotion_keys" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can update imports" ON "public"."imports" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins can update projects" ON "public"."projects" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Admins/Superadmins full access on imports" ON "public"."imports" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Allow admin and superadmin to delete projects" ON "public"."projects" FOR DELETE TO "authenticated" USING ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])));



CREATE POLICY "Allow authenticated users to create proposals" ON "public"."proposals" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow authors to edit pending proposals or staff to moderate" ON "public"."proposals" FOR UPDATE TO "authenticated" USING (((("auth"."uid"() = "user_id") AND ("status" = 'pending'::"text")) OR (( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = ANY (ARRAY['reviewer'::"text", 'admin'::"text", 'superadmin'::"text"]))));



CREATE POLICY "Allow key activation" ON "public"."promotion_keys" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Allow public read access on profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read access to all lines" ON "public"."lines" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read access to all projects" ON "public"."projects" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow read access to all proposals" ON "public"."proposals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Allow staff to insert promotion keys" ON "public"."promotion_keys" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])));



CREATE POLICY "Allow staff to read promotion keys" ON "public"."promotion_keys" FOR SELECT TO "authenticated" USING ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])));



CREATE POLICY "Allow staff to update lines" ON "public"."lines" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['reviewer'::"text", 'admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Allow superadmin to delete lines" ON "public"."lines" FOR DELETE TO "authenticated" USING ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = 'superadmin'::"text"));



CREATE POLICY "Allow superadmin to insert lines" ON "public"."lines" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = 'superadmin'::"text"));



CREATE POLICY "Allow superadmin to insert projects" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = 'superadmin'::"text"));



CREATE POLICY "Allow users to delete their own pending proposals" ON "public"."proposals" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") AND ("status" = 'pending'::"text")));



CREATE POLICY "Allow users to delete their own profile" ON "public"."profiles" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Allow users to update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id"));



CREATE POLICY "Authenticated users can insert proposals" ON "public"."proposals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Everyone can view imports" ON "public"."imports" FOR SELECT USING (true);



CREATE POLICY "Everyone can view lines" ON "public"."lines" FOR SELECT USING (true);



CREATE POLICY "Everyone can view projects" ON "public"."projects" FOR SELECT USING (true);



CREATE POLICY "Everyone can view proposals" ON "public"."proposals" FOR SELECT USING (true);



CREATE POLICY "Reviewers can update lines" ON "public"."lines" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['reviewer'::"text", 'admin'::"text", 'superadmin'::"text"]))))));



CREATE POLICY "Users can delete own pending proposals" ON "public"."proposals" FOR DELETE USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'superadmin'::"text"])))))));



CREATE POLICY "Users can update own pending proposals" ON "public"."proposals" FOR UPDATE USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['reviewer'::"text", 'admin'::"text", 'superadmin'::"text"])))))));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view all profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Users can view their redeemed keys" ON "public"."promotion_keys" FOR SELECT USING (("redeemed_by" = "auth"."uid"()));



ALTER TABLE "public"."imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promotion_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."proposals" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."lines";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."proposals";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."delete_project_cleanup"("p_project_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_project_cleanup"("p_project_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_project_cleanup"("p_project_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_promotion_key"("p_role_to_grant" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_promotion_key"("p_role_to_grant" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_promotion_key"("p_role_to_grant" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_next_untranslated_line"("p_project_id" "uuid", "p_current_sequence" integer, "p_total_lines" integer, "p_language" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_next_untranslated_line"("p_project_id" "uuid", "p_current_sequence" integer, "p_total_lines" integer, "p_language" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_next_untranslated_line"("p_project_id" "uuid", "p_current_sequence" integer, "p_total_lines" integer, "p_language" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_deleted_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_deleted_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_deleted_profile"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_or_service"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_or_service"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_service"() TO "service_role";



GRANT ALL ON FUNCTION "public"."propagate_bulk_import_by_lines"("p_project_id" "uuid", "p_import_id" "uuid", "p_line_ids" "uuid"[], "p_language" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."propagate_bulk_import_by_lines"("p_project_id" "uuid", "p_import_id" "uuid", "p_line_ids" "uuid"[], "p_language" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."propagate_bulk_import_by_lines"("p_project_id" "uuid", "p_import_id" "uuid", "p_line_ids" "uuid"[], "p_language" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_profile_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_profile_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_profile_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."redeem_promotion_key"("token_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."redeem_promotion_key"("token_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_promotion_key"("token_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rollback_import"("p_import_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."rollback_import"("p_import_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_import"("p_import_id" "uuid") TO "service_role";
























GRANT ALL ON TABLE "public"."imports" TO "anon";
GRANT ALL ON TABLE "public"."imports" TO "authenticated";
GRANT ALL ON TABLE "public"."imports" TO "service_role";



GRANT ALL ON TABLE "public"."lines" TO "anon";
GRANT ALL ON TABLE "public"."lines" TO "authenticated";
GRANT ALL ON TABLE "public"."lines" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."promotion_keys" TO "anon";
GRANT ALL ON TABLE "public"."promotion_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."promotion_keys" TO "service_role";



GRANT ALL ON TABLE "public"."proposals" TO "anon";
GRANT ALL ON TABLE "public"."proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."proposals" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Admins can manage po-files"
  on "storage"."objects"
  as permissive
  for all
  to public
using (((bucket_id = 'po-files'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text])))))))
with check (((bucket_id = 'po-files'::text) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['admin'::text, 'superadmin'::text])))))));



  create policy "Allow admin delete from po-files"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'po-files'::text) AND (( SELECT profiles.role
   FROM public.profiles
  WHERE (profiles.id = auth.uid())) = ANY (ARRAY['admin'::text, 'superadmin'::text]))));



  create policy "Allow authenticated uploads 1e7c7qh_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'po-files'::text));



  create policy "Allow authenticated uploads 1e7c7qh_1"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'po-files'::text));



  create policy "Anyone can view avatars"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'avatars'::text));



  create policy "Authenticated users can read po-files"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'po-files'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Permettre l'upload d'avatars aux connectés"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'avatars'::text));



  create policy "Permettre la lecture des avatars"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'avatars'::text));



  create policy "Permettre la modification des avatars"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'avatars'::text));



  create policy "Permettre la suppression des avatars"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'avatars'::text));



  create policy "Users can read own po-files"
  on "storage"."objects"
  as permissive
  for select
  to public
using (((bucket_id = 'po-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can update own avatar"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can upload own avatar"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



  create policy "Users can upload po-files to own folder"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'po-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));



