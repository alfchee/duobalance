-- Issue #264: the export route handler (and future trusted server code)
-- calls has_feature()/feature_limit() as service_role. The billing helpers
-- were granted to authenticated only (#257); this migration grants
-- service_role, and this test proves the grant exists — otherwise every
-- server-side gate would 500 with "permission denied for function".

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(3);

do $$
declare
  hh uuid := '10000000-0000-0000-0000-000000000099';
begin
  insert into auth.users (id, email) values
    ('99555555-5555-5555-5555-555555555555', 'service-role-gate@test.local');

  insert into public.households (id, name, country, base_currency, timezone) values
    (hh, 'Service Role Gate', 'CL', 'CLP', 'America/Santiago');

  insert into public.household_members (household_id, user_id, role, display_name)
  values (hh, '99555555-5555-5555-5555-555555555555', 'owner', 'Owner');

  insert into public.subscriptions (household_id, plan_code, provider, status)
  values (hh, 'free', 'stub', 'active');
end $$;

-- has_feature and feature_limit execute as service_role after the grant.
set local role service_role;
select is(
  public.has_feature('10000000-0000-0000-0000-000000000099', 'export'),
  false,
  'service_role: has_feature executes (grant works) and answers the plan'
);
select is(
  public.feature_limit('10000000-0000-0000-0000-000000000099', 'accounts'),
  4,
  'service_role: feature_limit executes and reads the free-plan limit'
);

-- household_plan is reachable only as part of the has_feature/feature_limit
-- call chain; a direct service_role call resolves the same plan it powers.
select is(
  public.household_plan('10000000-0000-0000-0000-000000000099'),
  'free',
  'service_role: household_plan executes (has_feature call chain needs it)'
);

reset role;
select * from finish();
