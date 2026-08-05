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
-- run as the `authenticated` role with that user's JWT.
create or replace function tests.authenticate_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text,
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

-- Fixed UUIDs for cross-file fixtures. Tests use these so each test is
-- self-contained and runs against a known shape.
do $$
begin
  -- No-op: tests inline their own INSERTs inside a transaction.
  -- This block exists so the helpers file is always safe to re-`\i`.
end
$$;
