-- Metrics dashboard source index (code-review follow-up on #275): the
-- composite (source, slug) index backing the content articles/sources
-- aggregations exists.

\set ON_ERROR_STOP on
\i supabase/tests/_lib/helpers.sql

begin;

select plan(1);

select results_eq(
  $$ select count(*)::int from pg_indexes
      where schemaname = 'public'
        and tablename = 'guide_opens'
        and indexname = 'guide_opens_source_slug_idx' $$,
  $$ values (1) $$,
  'guide_opens_source_slug_idx exists'
);

select * from finish();
