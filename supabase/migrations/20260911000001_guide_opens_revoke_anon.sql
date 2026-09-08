-- Follow-up to 20260911000000: revoke anon grant added in review.
-- Idempotent: revoke if present, no-op otherwise.

revoke select, insert on public.guide_opens from anon;
