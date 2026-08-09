\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(2);

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transactions'
  ),
  'transactions are published to Supabase Realtime'
);

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'accounts'
  ),
  'accounts are published to Supabase Realtime'
);

select * from finish();

rollback;
