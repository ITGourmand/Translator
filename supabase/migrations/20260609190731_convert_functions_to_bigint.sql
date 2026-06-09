-- 1. Drop the uuid-based functions to clean up the schema
drop function if exists public.propagate_bulk_import_by_lines(uuid, uuid, uuid[], text);
drop function if exists public.rollback_import(uuid);
drop function if exists public.get_next_untranslated_line(uuid, integer, integer, text);

-- 2. Create the bigint-based functions matching the actual database tables
create or replace function public.rollback_import(p_import_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.proposals where import_id = p_import_id;
    delete from public.imports where id = p_import_id;
end;
$$;

create or replace function public.get_next_untranslated_line(
    p_project_id      bigint,
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

create or replace function public.propagate_bulk_import_by_lines(
    p_project_id bigint,
    p_import_id  bigint,
    p_line_ids   bigint[],
    p_language   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.lines
    set locked_languages = array_append(locked_languages, p_language)
    where id = any(p_line_ids)
      and project_id = p_project_id
      and not (locked_languages @> array[p_language]);
end;
$$;

-- 3. Redefine promotion key functions to match the actual remote schema columns (code, role_to_grant, is_used, redeemed_by, redeemed_at)
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

    insert into public.promotion_keys (code, role_to_grant, is_used)
    values (v_code, p_role_to_grant, false);

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
