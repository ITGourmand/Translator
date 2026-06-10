-- =============================================================================
-- TranslatorWeb — Complete Database Schema (Idempotent)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES (UUID-based)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
    id         uuid primary key references auth.users(id) on delete cascade,
    username   text not null default '',
    role       text not null default 'translator'
                    check (role in ('translator', 'reviewer', 'admin', 'superadmin')),
    avatar_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.projects (
    id              uuid primary key default gen_random_uuid(),
    name            text not null default '',
    source_language text not null default 'EN',
    po_storage_path text,
    created_at      timestamptz not null default now()
);

create table if not exists public.lines (
    id               uuid primary key default gen_random_uuid(),
    project_id       uuid not null references public.projects(id) on delete cascade,
    msgid            text not null default '',
    sequence_order   integer not null default 0,
    locked_languages text[] not null default '{}',
    created_at       timestamptz not null default now()
);

create table if not exists public.imports (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null references public.projects(id) on delete cascade,
    user_id      uuid not null references auth.users(id) on delete cascade,
    file_name    text not null default '',
    language     text not null default '',
    storage_path text,
    is_variant   boolean not null default false,
    created_at   timestamptz not null default now()
);

alter table public.imports
    add column if not exists total_entries integer not null default 0,
    add column if not exists imported_count integer not null default 0,
    add column if not exists skipped_approved_count integer not null default 0,
    add column if not exists skipped_duplicate_msgid_count integer not null default 0,
    add column if not exists skipped_missing_msgid_count integer not null default 0,
    add column if not exists skipped_empty_count integer not null default 0;

create table if not exists public.proposals (
    id         uuid primary key default gen_random_uuid(),
    line_id    uuid not null references public.lines(id) on delete cascade,
    user_id    uuid not null references auth.users(id) on delete cascade,
    msgstr     text not null default '',
    language   text not null default '',
    status     text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
    import_id  uuid references public.imports(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.promotion_keys (
    id             uuid primary key default gen_random_uuid(),
    code           text not null unique,
    role_to_grant  text not null check (role_to_grant in ('reviewer', 'admin')),
    created_by     uuid not null references auth.users(id) on delete cascade,
    redeemed_by    uuid references auth.users(id) on delete set null,
    redeemed_at    timestamptz,
    is_used        boolean not null default false,
    created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. INDEXES
-- ---------------------------------------------------------------------------

create index if not exists idx_lines_project_id on public.lines(project_id);
create index if not exists idx_lines_project_sequence on public.lines(project_id, sequence_order);
create index if not exists idx_lines_project_msgid on public.lines(project_id, msgid);
create index if not exists idx_imports_project_id on public.imports(project_id);
create index if not exists idx_imports_project_created_at on public.imports(project_id, created_at desc);
create index if not exists idx_proposals_line_id on public.proposals(line_id);
create index if not exists idx_proposals_line_language on public.proposals(line_id, language);
create index if not exists idx_proposals_import_id on public.proposals(import_id);
create index if not exists idx_proposals_language_status_line on public.proposals(language, status, line_id);

-- ---------------------------------------------------------------------------
-- 3. TRIGGER: auto-create profile on new auth.users signup
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. RPC FUNCTIONS
-- ---------------------------------------------------------------------------

create or replace function public.is_admin_or_service()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        auth.role() = 'service_role'
        or exists (
            select 1
            from public.profiles
            where id = auth.uid()
              and role in ('admin', 'superadmin')
        );
$$;

create or replace function public.rollback_import(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.get_next_untranslated_line(
    p_project_id      uuid,
    p_current_sequence integer,
    p_total_lines      integer,
    p_language         text
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
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

create or replace function public.generate_promotion_key(p_role_to_grant text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.redeem_promotion_key(token_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.propagate_bulk_import_by_lines(
    p_project_id uuid,
    p_import_id  uuid,
    p_line_ids   uuid[],
    p_language   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function public.delete_project_cleanup(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin_or_service() then
        raise exception 'Forbidden: insufficient privileges';
    end if;

    -- 1. Supprimer tous les fichiers associés au projet dans le bucket storage.objects
    delete from storage.objects
    where bucket_id = 'po-files'
      and name like 'projects/' || p_project_id || '/%';

    -- 2. Supprimer le projet (cascade va supprimer lines, imports, proposals)
    delete from public.projects
    where id = p_project_id;

    -- 3. Si plus aucun projet n'existe, on reset les compteurs / nettoie le stockage
    if not exists (select 1 from public.projects) then
        delete from storage.objects where bucket_id = 'po-files';
    end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.lines enable row level security;
alter table public.proposals enable row level security;
alter table public.imports enable row level security;
alter table public.promotion_keys enable row level security;

-- Drop all policies first to make this idempotent
drop policy if exists "Users can view all profiles" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Everyone can view projects" on public.projects;
drop policy if exists "Admins can insert projects" on public.projects;
drop policy if exists "Admins can update projects" on public.projects;
drop policy if exists "Admins can delete projects" on public.projects;
drop policy if exists "Everyone can view lines" on public.lines;
drop policy if exists "Admins can insert lines" on public.lines;
drop policy if exists "Reviewers can update lines" on public.lines;
drop policy if exists "Everyone can view proposals" on public.proposals;
drop policy if exists "Authenticated users can insert proposals" on public.proposals;
drop policy if exists "Users can update own pending proposals" on public.proposals;
drop policy if exists "Users can delete own pending proposals" on public.proposals;
drop policy if exists "Everyone can view imports" on public.imports;
drop policy if exists "Admins can insert imports" on public.imports;
drop policy if exists "Admins can update imports" on public.imports;
drop policy if exists "Admins can delete imports" on public.imports;
drop policy if exists "Admins can manage promotion keys" on public.promotion_keys;
drop policy if exists "Users can view their redeemed keys" on public.promotion_keys;

-- profiles
create policy "Users can view all profiles"
    on public.profiles for select
    using (true);

create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- projects
create policy "Everyone can view projects"
    on public.projects for select
    using (true);

create policy "Admins can insert projects"
    on public.projects for insert
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Admins can update projects"
    on public.projects for update
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    )
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Admins can delete projects"
    on public.projects for delete
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

-- lines
create policy "Everyone can view lines"
    on public.lines for select
    using (true);

create policy "Admins can insert lines"
    on public.lines for insert
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Reviewers can update lines"
    on public.lines for update
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('reviewer', 'admin', 'superadmin')
        )
    );

-- proposals
create policy "Everyone can view proposals"
    on public.proposals for select
    using (true);

create policy "Authenticated users can insert proposals"
    on public.proposals for insert
    with check (auth.uid() = user_id);

create policy "Users can update own pending proposals"
    on public.proposals for update
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('reviewer', 'admin', 'superadmin')
        )
    );

create policy "Users can delete own pending proposals"
    on public.proposals for delete
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

-- imports
create policy "Everyone can view imports"
    on public.imports for select
    using (true);

create policy "Admins can insert imports"
    on public.imports for insert
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Admins can update imports"
    on public.imports for update
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    )
    with check (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Admins can delete imports"
    on public.imports for delete
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

-- promotion_keys
create policy "Admins can manage promotion keys"
    on public.promotion_keys for all
    using (
        exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Users can view their redeemed keys"
    on public.promotion_keys for select
    using (redeemed_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. STORAGE BUCKETS AND OBJECT POLICIES
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('po-files', 'po-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Drop storage policies first to make this idempotent
drop policy if exists "Admins can manage po-files" on storage.objects;
drop policy if exists "Authenticated users can read po-files" on storage.objects;
drop policy if exists "Anyone can view avatars" on storage.objects;
drop policy if exists "Users can upload own avatar" on storage.objects;
drop policy if exists "Users can update own avatar" on storage.objects;

create policy "Admins can manage po-files"
    on storage.objects for all
    using (
        bucket_id = 'po-files'
        and exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    )
    with check (
        bucket_id = 'po-files'
        and exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('admin', 'superadmin')
        )
    );

create policy "Authenticated users can read po-files"
    on storage.objects for select
    using (
        bucket_id = 'po-files'
        and auth.role() = 'authenticated'
    );

create policy "Anyone can view avatars"
    on storage.objects for select
    using (bucket_id = 'avatars');

create policy "Users can upload own avatar"
    on storage.objects for insert
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "Users can update own avatar"
    on storage.objects for update
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ---------------------------------------------------------------------------
-- 7. REALTIME PUBLICATION
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'proposals'
    ) then
        alter publication supabase_realtime add table public.proposals;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and tablename = 'lines'
    ) then
        alter publication supabase_realtime add table public.lines;
    end if;
end;
$$;
