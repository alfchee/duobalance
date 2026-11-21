-- Metrics dashboard: source index (code-review follow-up on #275).
-- Forward-only: no function change, index-only migration.
--
-- admin_metrics_content_articles/sources filter guide_opens on
-- source IN (...) / IS DISTINCT FROM with GROUP BY slug/src, but the only
-- indexes were (household_id), (user_id), (slug), (created_at) — every
-- dashboard load seq-scanned guide_opens as it grows. Composite
-- (source, slug) serves both the filter and the grouping.

create index if not exists guide_opens_source_slug_idx
  on public.guide_opens (source, slug);
