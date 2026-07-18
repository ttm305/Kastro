-- Bug found during live testing of the new Branch Management RPCs:
-- admin_reorder_branches called private.log_admin_action(actor, action,
-- category, target, detail) with exactly 5 positional args. Two overloads
-- exist (a 5-arg original and an 8-arg one whose last 3 params default to
-- null), so a 5-arg call is genuinely ambiguous to Postgres's overload
-- resolver ("function ... is not unique"). Every other new RPC in this
-- migration set happened to pass 8 args explicitly and never hit this;
-- fixed here by doing the same — passing the 3 trailing args explicitly.
create or replace function public.admin_reorder_branches(p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_id uuid;
  v_pos integer := 0;
begin
  perform private.require_owner();
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    raise exception 'No branch order supplied' using errcode = '22023';
  end if;

  foreach v_id in array p_ordered_ids loop
    v_pos := v_pos + 1;
    update public.branches set sort_order = v_pos where id = v_id;
  end loop;

  perform private.log_admin_action(
    auth.uid(), 'Reorder Branches', 'branches', 'branches',
    array_length(p_ordered_ids, 1)::text || ' branches reordered',
    null, null, null
  );
end; $$;
