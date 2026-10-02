-- Test helpers. Lives in _lib/ so the `*.sql` glob in package.json's
-- db:test doesn't pick it up. Each test file does `\i supabase/tests/_lib/helpers.sql`
-- at the top.

-- `supabase db reset` recreates the public schema, which wipes the pgtap
-- extension. Re-installing it at the top of each test run keeps the suite
-- self-contained — no manual `create extension pgtap` step required.
create extension if not exists pgtap;

create schema if not exists tests;

-- The test helper functions need to be callable by the `authenticated` role,
-- which is what tests use to simulate an end-user session. These grants
-- live in the helpers (not in a migration) because the `tests` schema
-- itself only exists at test time.
grant usage on schema tests to anon, authenticated;
alter default privileges in schema tests
  grant execute on functions to anon, authenticated;

-- Switch to a specific user. Subsequent queries in the same transaction
-- run as the `authenticated` role with that user's JWT. user_email is
-- optional — only RLS/RPCs that read auth.jwt()->>'email' (e.g.
-- accept_invite) need it.
create or replace function tests.authenticate_as(user_id uuid, user_email text default null)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated', 'email', user_email)::text,
    true
  );
end;
$$;

-- Run as the unauthenticated `anon` role. Used to assert that no
-- household-scoped data leaks to unauthenticated traffic.
create or replace function tests.authenticate_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'anon')::text,
    true
  );
end;
$$;

-- Reset to the postgres superuser (no auth context). Used between
-- test setups that need to bypass RLS.
create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Entitle a fixture household with a live subscription (#261). Enforcement
-- is fail-closed (no subscription -> can_write() false, accounts limit 0),
-- so any fixture that inserts accounts or writes a gated table as an
-- authenticated member needs this during the superuser setup phase.
-- 'plus' keeps counts unlimited so existing fixtures behave exactly as
-- before; pass 'free' only when the test wants the free limits.
create or replace function tests.entitle_household(p_household uuid, p_plan text default 'plus')
returns void
language plpgsql
as $$
begin
  insert into public.subscriptions (household_id, plan_code, provider, status, current_period_end)
  values (p_household, p_plan, 'stub', 'active', now() + interval '30 days');
end;
$$;

-- Fixed UUIDs for cross-file fixtures. Tests use these so each test is
-- self-contained and runs against a known shape.
do $$
begin
  -- No-op: tests inline their own INSERTs inside a transaction.
  -- This block exists so the helpers file is always safe to re-`\i`.
end
$$;
