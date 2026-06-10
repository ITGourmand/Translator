-- =============================================================================
-- TranslatorWeb - Convert legacy numeric project tables to UUID keys
-- =============================================================================
--
-- Older remote databases were created with bigint identities for projects,
-- lines, imports, and proposals. The current application and RPC functions use
-- UUIDs, so existing bigint tables must be converted instead of only backfilled.

do $$
declare
    v_projects_id_type text;
begin
    select data_type
    into v_projects_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'id';

    if v_projects_id_type = 'uuid' then
        return;
    end if;

    drop trigger if exists trigger_propagate_proposals on public.proposals;
    drop trigger if exists trigger_propagate_translation on public.proposals;

    alter table public.proposals drop constraint if exists proposals_import_id_fkey;
    alter table public.proposals drop constraint if exists proposals_line_id_fkey;
    alter table public.imports drop constraint if exists imports_project_id_fkey;
    alter table public.lines drop constraint if exists lines_project_id_fkey;

    alter table public.proposals drop constraint if exists unique_user_line_language_approved;

    drop index if exists public.idx_imports_project_created_at;
    drop index if exists public.idx_imports_project_id;
    drop index if exists public.idx_lines_project_id;
    drop index if exists public.idx_lines_project_id_msgid;
    drop index if exists public.idx_lines_project_msgid;
    drop index if exists public.idx_lines_project_sequence;
    drop index if exists public.idx_proposals_import_id;
    drop index if exists public.idx_proposals_import_line;
    drop index if exists public.idx_proposals_language_status_line;
    drop index if exists public.idx_proposals_line_id;
    drop index if exists public.idx_proposals_line_language;
    drop index if exists public.unique_pending_proposal_per_user;

    alter table public.projects add column if not exists uuid_id uuid default gen_random_uuid();
    alter table public.lines add column if not exists uuid_id uuid default gen_random_uuid();
    alter table public.imports add column if not exists uuid_id uuid default gen_random_uuid();
    alter table public.proposals add column if not exists uuid_id uuid default gen_random_uuid();

    update public.projects set uuid_id = gen_random_uuid() where uuid_id is null;
    update public.lines set uuid_id = gen_random_uuid() where uuid_id is null;
    update public.imports set uuid_id = gen_random_uuid() where uuid_id is null;
    update public.proposals set uuid_id = gen_random_uuid() where uuid_id is null;

    alter table public.lines add column if not exists uuid_project_id uuid;
    alter table public.imports add column if not exists uuid_project_id uuid;
    alter table public.proposals add column if not exists uuid_line_id uuid;
    alter table public.proposals add column if not exists uuid_import_id uuid;

    update public.lines l
    set uuid_project_id = p.uuid_id
    from public.projects p
    where l.project_id = p.id;

    update public.imports i
    set uuid_project_id = p.uuid_id
    from public.projects p
    where i.project_id = p.id;

    update public.proposals p
    set uuid_line_id = l.uuid_id
    from public.lines l
    where p.line_id = l.id;

    update public.proposals p
    set uuid_import_id = i.uuid_id
    from public.imports i
    where p.import_id = i.id;

    if exists (select 1 from public.lines where uuid_project_id is null) then
        raise exception 'Cannot convert lines.project_id to uuid: orphaned project references exist.';
    end if;

    if exists (select 1 from public.imports where uuid_project_id is null) then
        raise exception 'Cannot convert imports.project_id to uuid: orphaned project references exist.';
    end if;

    if exists (select 1 from public.proposals where uuid_line_id is null) then
        raise exception 'Cannot convert proposals.line_id to uuid: orphaned line references exist.';
    end if;

    alter table public.proposals drop constraint if exists proposals_pkey;
    alter table public.imports drop constraint if exists imports_pkey;
    alter table public.lines drop constraint if exists lines_pkey;
    alter table public.projects drop constraint if exists projects_pkey;

    alter table public.projects alter column id drop identity if exists;
    alter table public.lines alter column id drop identity if exists;
    alter table public.imports alter column id drop identity if exists;
    alter table public.proposals alter column id drop identity if exists;

    alter table public.projects rename column id to legacy_id;
    alter table public.projects rename column uuid_id to id;

    alter table public.lines rename column id to legacy_id;
    alter table public.lines rename column project_id to legacy_project_id;
    alter table public.lines rename column uuid_id to id;
    alter table public.lines rename column uuid_project_id to project_id;

    alter table public.imports rename column id to legacy_id;
    alter table public.imports rename column project_id to legacy_project_id;
    alter table public.imports rename column uuid_id to id;
    alter table public.imports rename column uuid_project_id to project_id;

    alter table public.proposals rename column id to legacy_id;
    alter table public.proposals rename column line_id to legacy_line_id;
    alter table public.proposals rename column import_id to legacy_import_id;
    alter table public.proposals rename column uuid_id to id;
    alter table public.proposals rename column uuid_line_id to line_id;
    alter table public.proposals rename column uuid_import_id to import_id;

    alter table public.projects alter column id set not null;
    alter table public.projects alter column id set default gen_random_uuid();
    alter table public.lines alter column id set not null;
    alter table public.lines alter column id set default gen_random_uuid();
    alter table public.lines alter column project_id set not null;
    alter table public.imports alter column id set not null;
    alter table public.imports alter column id set default gen_random_uuid();
    alter table public.imports alter column project_id set not null;
    alter table public.proposals alter column id set not null;
    alter table public.proposals alter column id set default gen_random_uuid();
    alter table public.proposals alter column line_id set not null;

    alter table public.projects alter column legacy_id drop not null;
    alter table public.lines alter column legacy_id drop not null;
    alter table public.lines alter column legacy_project_id drop not null;
    alter table public.imports alter column legacy_id drop not null;
    alter table public.imports alter column legacy_project_id drop not null;
    alter table public.proposals alter column legacy_id drop not null;
    alter table public.proposals alter column legacy_line_id drop not null;

    alter table public.projects add constraint projects_pkey primary key (id);
    alter table public.lines add constraint lines_pkey primary key (id);
    alter table public.imports add constraint imports_pkey primary key (id);
    alter table public.proposals add constraint proposals_pkey primary key (id);

    alter table public.lines
        add constraint lines_project_id_fkey
        foreign key (project_id) references public.projects(id) on delete cascade;

    alter table public.imports
        add constraint imports_project_id_fkey
        foreign key (project_id) references public.projects(id) on delete cascade;

    alter table public.proposals
        add constraint proposals_line_id_fkey
        foreign key (line_id) references public.lines(id) on delete cascade;

    alter table public.proposals
        add constraint proposals_import_id_fkey
        foreign key (import_id) references public.imports(id) on delete set null;

    alter table public.proposals
        add constraint unique_user_line_language_approved unique (user_id, line_id, language);

    drop sequence if exists public.projects_id_seq;
    drop sequence if exists public.lines_id_seq;
    drop sequence if exists public.imports_id_seq;
    drop sequence if exists public.proposals_id_seq;
end;
$$;

drop function if exists public.get_next_untranslated_line(bigint, integer, integer, text);
drop function if exists public.propagate_bulk_import(bigint, bigint, integer, integer);
drop function if exists public.propagate_bulk_import_by_lines(bigint, bigint, bigint[], text);
drop function if exists public.rollback_import(bigint);
drop function if exists public.propagate_proposal_changes();
drop function if exists public.propagate_translation();

create index if not exists idx_lines_project_id on public.lines(project_id);
create index if not exists idx_lines_project_sequence on public.lines(project_id, sequence_order);
create index if not exists idx_lines_project_msgid on public.lines(project_id, msgid);
create index if not exists idx_imports_project_id on public.imports(project_id);
create index if not exists idx_imports_project_created_at on public.imports(project_id, created_at desc);
create index if not exists idx_proposals_line_id on public.proposals(line_id);
create index if not exists idx_proposals_line_language on public.proposals(line_id, language);
create index if not exists idx_proposals_import_id on public.proposals(import_id);
create index if not exists idx_proposals_language_status_line on public.proposals(language, status, line_id);
create unique index if not exists unique_pending_proposal_per_user
    on public.proposals(user_id, line_id, language)
    where status = 'pending';

notify pgrst, 'reload schema';
