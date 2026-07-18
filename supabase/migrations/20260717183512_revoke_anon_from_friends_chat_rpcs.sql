-- Security hardening found during this delivery's review pass (section 8):
-- every RPC in the original Friends + Chat build (migration
-- 20260716200757_friends_chat_functions.sql) was created without an
-- explicit `revoke ... from anon`, so PostgreSQL's default "EXECUTE
-- granted to PUBLIC on every new function" left all of them callable by
-- unauthenticated (anon-key) callers via PostgREST — including
-- send_message, block_user, report_user, send_friend_request, etc.
--
-- Each of these functions does check auth.uid() internally, but several
-- use the pattern `if auth.uid() not in (a, b) then raise ...`, and SQL's
-- NULL-propagation means that check silently evaluates to NULL (treated
-- as false, i.e. "don't raise") when auth.uid() is NULL — an anonymous
-- caller doesn't cleanly hit "Forbidden", it falls through and typically
-- only fails later on an unrelated NOT NULL constraint. That's fragile:
-- it happens to fail today, not because it was designed to reject
-- unauthenticated calls, but as a side effect of a downstream constraint.
--
-- This migration closes it at the grant level, matching the same
-- `revoke all ... from public, anon` pattern already used correctly for
-- every owner/admin RPC and for the new messaging RPCs added in this
-- delivery (toggle_save_message, register_push_subscription, etc.) —
-- this migration just brings the *original* friends/chat RPC set up to
-- that same standard. No behavior changes for any legitimate
-- (authenticated) caller — re-verified live after applying.

revoke execute on function public.send_message(uuid, text, uuid) from public, anon;
revoke execute on function public.get_or_create_conversation(uuid) from public, anon;
revoke execute on function public.open_conversation(uuid) from public, anon;
revoke execute on function public.heartbeat_conversation(uuid) from public, anon;
revoke execute on function public.leave_conversation(uuid) from public, anon;
revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.report_user(uuid, uuid, text) from public, anon;
revoke execute on function public.send_friend_request(uuid) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;

grant execute on function public.send_message(uuid, text, uuid) to authenticated;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;
grant execute on function public.open_conversation(uuid) to authenticated;
grant execute on function public.heartbeat_conversation(uuid) to authenticated;
grant execute on function public.leave_conversation(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.report_user(uuid, uuid, text) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;

-- private.* helpers are never reachable via PostgREST (private isn't an
-- exposed API schema), but revoke here too as defense in depth — nothing
-- should be able to invoke leave_conversation_for/send_push_for_new_message
-- with an arbitrary p_user_id except the SECURITY DEFINER callers that
-- already do their own auth checks before calling them.
revoke execute on function private.leave_conversation_for(uuid, uuid) from public, anon;
revoke execute on function private.send_push_for_new_message(uuid, text, text, text, text, jsonb) from public, anon;
revoke execute on function private.are_friends(uuid, uuid) from public, anon;
revoke execute on function private.is_blocked(uuid, uuid) from public, anon;
revoke execute on function private.notify(uuid, text, text, text, text, text, jsonb) from public, anon;
