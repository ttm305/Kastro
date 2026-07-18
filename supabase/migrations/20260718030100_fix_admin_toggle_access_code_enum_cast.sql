-- Found during live testing required by the log_admin_action overload-
-- ambiguity fix: admin_toggle_access_code has always been broken for an
-- unrelated reason. Its UPDATE does
--   set status = case when status='active' then 'disabled' else 'active' end
-- which produces `text`, but access_codes.status is the enum `code_status`
-- ('active'/'disabled') -- Postgres refuses the implicit text->enum
-- assignment ("column \"status\" is of type code_status but expression is
-- of type text"). This means Enable/Disable Code has never worked, in any
-- version of this function, independent of the log_admin_action bug. Fixed
-- by casting each branch to code_status explicitly.
create or replace function public.admin_toggle_access_code(p_code_id uuid)
returns access_codes
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.access_codes; begin
  perform private.require_owner();
  update public.access_codes set status = case when status='active' then 'disabled'::code_status else 'active'::code_status end
  where id = p_code_id returning * into v_row;
  if v_row.id is null then
    raise exception 'Access code not found' using errcode = '22023';
  end if;
  perform private.log_admin_action(auth.uid(), case when v_row.status='active' then 'Enable Code' else 'Disable Code' end, 'codes', v_row.code, 'Access code ' || v_row.status, null::uuid, null::text, null::text);
  return v_row;
end; $$;
