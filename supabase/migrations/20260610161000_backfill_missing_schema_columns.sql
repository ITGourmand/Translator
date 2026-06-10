-- =============================================================================
-- TranslatorWeb - Backfill columns added after the initial schema migration
-- =============================================================================
--
-- Supabase records applied migrations by filename. If complete_schema.sql was
-- applied before these columns existed, editing that migration is not enough for
-- an already-created database. This migration safely catches older databases up.

alter table public.profiles
    add column if not exists username text not null default '',
    add column if not exists role text not null default 'translator',
    add column if not exists avatar_url text,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

alter table public.projects
    add column if not exists name text not null default '',
    add column if not exists source_language text not null default 'EN',
    add column if not exists po_storage_path text,
    add column if not exists created_at timestamptz not null default now();

alter table public.lines
    add column if not exists project_id uuid references public.projects(id) on delete cascade,
    add column if not exists msgid text not null default '',
    add column if not exists sequence_order integer not null default 0,
    add column if not exists locked_languages text[] not null default '{}',
    add column if not exists created_at timestamptz not null default now();

alter table public.imports
    add column if not exists project_id uuid references public.projects(id) on delete cascade,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists file_name text not null default '',
    add column if not exists language text not null default '',
    add column if not exists storage_path text,
    add column if not exists is_variant boolean not null default false,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists total_entries integer not null default 0,
    add column if not exists imported_count integer not null default 0,
    add column if not exists skipped_approved_count integer not null default 0,
    add column if not exists skipped_duplicate_msgid_count integer not null default 0,
    add column if not exists skipped_missing_msgid_count integer not null default 0,
    add column if not exists skipped_empty_count integer not null default 0;

alter table public.proposals
    add column if not exists line_id uuid references public.lines(id) on delete cascade,
    add column if not exists user_id uuid references auth.users(id) on delete cascade,
    add column if not exists msgstr text not null default '',
    add column if not exists language text not null default '',
    add column if not exists status text not null default 'pending',
    add column if not exists import_id uuid references public.imports(id) on delete set null,
    add column if not exists created_at timestamptz not null default now();

alter table public.promotion_keys
    add column if not exists code text,
    add column if not exists role_to_grant text,
    add column if not exists created_by uuid references auth.users(id) on delete cascade,
    add column if not exists redeemed_by uuid references auth.users(id) on delete set null,
    add column if not exists redeemed_at timestamptz,
    add column if not exists is_used boolean not null default false,
    add column if not exists created_at timestamptz not null default now();

notify pgrst, 'reload schema';
