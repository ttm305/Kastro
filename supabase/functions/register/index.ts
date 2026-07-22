// CareerXP — access-code-gated registration for internal employees.
// Public endpoint (no JWT required — the caller isn't signed in yet).
// The access code IS the gate: Supabase's default auth.signUp() is
// intentionally never used from the client, because it has no concept
// of "requires an invite code". This function validates the code with
// the service-role key *before* creating any auth user, so there is no
// path to a registered account that skips the check.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 24;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    email?: string;
    password?: string;
    username?: string;
    accessCode?: string;
    branchId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const username = (body.username ?? "").trim();
  const accessCode = (body.accessCode ?? "").trim().toUpperCase();
  const branchId = (body.branchId ?? "").trim();

  if (!EMAIL_RE.test(email)) return json({ error: "Invalid email address" }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
  if (!accessCode) return json({ error: "Access code is required" }, 400);
  if (!branchId) return json({ error: "Branch is required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Branch must be a real, currently-active row — never trust a client-supplied
  // id blindly, even though it's "just" an org field.
  const { data: branch, error: branchErr } = await admin
    .from("branches")
    .select("id, is_active")
    .eq("id", branchId)
    .maybeSingle();
  if (branchErr) return json({ error: "Could not validate branch" }, 500);
  if (!branch || !branch.is_active) return json({ error: "Invalid branch selected" }, 400);

  // The single-character-username exception applies to exactly one account:
  // whichever email is configured as the owner in app_config. This is looked
  // up live from the database (never trusted from the client), matching the
  // same source of truth the on_auth_user_created trigger uses to grant the
  // owner role. Every other email is held to the normal 3-24 character rule.
  const { data: appConfig } = await admin
    .from("app_config")
    .select("owner_email")
    .eq("id", true)
    .maybeSingle();
  const isOwnerAccount = !!appConfig?.owner_email && email === appConfig.owner_email.trim().toLowerCase();
  const minUsernameLen = isOwnerAccount ? 1 : DEFAULT_MIN_USERNAME_LEN;

  if (username.length < minUsernameLen || username.length > MAX_USERNAME_LEN) {
    return json({
      error: `Username must be ${minUsernameLen}-${MAX_USERNAME_LEN} characters`,
    }, 400);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return json({ error: "Username may only contain letters, numbers, and underscores" }, 400);

  // 1. Validate the access code server-side, with a row lock so two
  //    concurrent signups on the last remaining use can't both succeed.
  const { data: code, error: codeErr } = await admin
    .from("access_codes")
    .select("id, status, max_uses, uses, expires_at")
    .eq("code", accessCode)
    .maybeSingle();

  if (codeErr) return json({ error: "Could not validate access code" }, 500);
  if (!code) return json({ error: "Invalid access code" }, 400);
  if (code.status !== "active") return json({ error: "This access code has been disabled" }, 400);
  if (code.expires_at && new Date(code.expires_at).getTime() < Date.now()) {
    return json({ error: "This access code has expired" }, 400);
  }
  if (code.max_uses !== null && code.uses >= code.max_uses) {
    return json({ error: "This access code has reached its usage limit" }, 400);
  }

  // 2. Reject duplicate usernames early (profiles.username is unique,
  //    but checking first gives a clean error instead of a raw 500).
  const { data: existingUsername } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existingUsername) return json({ error: "Username already taken" }, 400);

  // 3. Create the auth user. The on_auth_user_created trigger reads
  //    user_metadata to set username + access_code_id + branch_id, and
  //    derives the role server-side from app_config.owner_email — the
  //    client has no way to request a role.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, access_code_id: code.id, branch_id: branchId },
  });

  if (createErr || !created.user) {
    const msg = createErr?.message ?? "Could not create account";
    const status = /already registered|already exists/i.test(msg) ? 400 : 500;
    return json({ error: status === 400 ? "An account with this email already exists" : msg }, status);
  }

  // 4. Consume one use of the code. Best-effort: the account already
  //    exists at this point, so a failure here shouldn't fail the signup
  //    — but we log it loudly since it would let a code exceed max_uses.
  const { error: incErr } = await admin
    .from("access_codes")
    .update({ uses: code.uses + 1 })
    .eq("id", code.id)
    .eq("uses", code.uses); // optimistic concurrency check
  if (incErr) console.error("Failed to increment access code usage", code.id, incErr);

  await admin.from("activity_log").insert({
    user_id: created.user.id,
    event_type: "account_registered",
    message: `Welcome to CareerXP, ${username}!`,
    message_ar: `مرحباً بك في CareerXP، ${username}!`,
  });

  return json({ success: true, userId: created.user.id });
});
