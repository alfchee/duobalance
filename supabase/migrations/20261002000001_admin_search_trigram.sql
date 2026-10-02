-- Admin household search: trigram index (code-review follow-up on #272).
-- Forward-only: no function change, index-only migration.
--
-- admin_list_households() filters h.name (and h.id::text) with a
-- leading-wildcard ILIKE on every keystroke — non-sargable, so each page
-- seq-scans households as the table grows. pg_trgm's GIN opclass makes
-- LIKE/ILIKE patterns indexable, including leading wildcards. The email
-- EXISTS branch is left as-is: auth.users is outside our schema (no index
-- we may own there) and that probe is bounded by the household's member
-- rows; the name trigram covers the common support-paste case.

create extension if not exists "pg_trgm" with schema "extensions";

create index if not exists households_name_trgm_idx
  on public.households using gin (name extensions.gin_trgm_ops);
