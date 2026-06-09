-- Drop old overloaded functions that used integer instead of uuid
drop function if exists public.propagate_bulk_import_by_lines(integer, integer, integer[], text);
drop function if exists public.rollback_import(integer);
drop function if exists public.get_next_untranslated_line(integer, integer, integer, text);
