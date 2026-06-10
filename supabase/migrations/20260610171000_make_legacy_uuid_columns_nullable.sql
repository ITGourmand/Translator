-- =============================================================================
-- TranslatorWeb - Allow new UUID rows after legacy id conversion
-- =============================================================================
--
-- legacy_* columns preserve numeric ids from older databases. New rows generated
-- after the UUID conversion do not have legacy numeric ids, so these columns must
-- be nullable.

alter table public.projects
    alter column legacy_id drop not null;

alter table public.lines
    alter column legacy_id drop not null,
    alter column legacy_project_id drop not null;

alter table public.imports
    alter column legacy_id drop not null,
    alter column legacy_project_id drop not null;

alter table public.proposals
    alter column legacy_id drop not null,
    alter column legacy_line_id drop not null;

notify pgrst, 'reload schema';
