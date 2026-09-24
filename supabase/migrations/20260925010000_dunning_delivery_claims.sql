-- Issue #265 follow-up (PR #287 review: send-before-claim allows duplicate
-- sends): claim-first delivery for dunning_deliveries.
--
-- The job used to send the email and THEN insert the ledger row, so two
-- concurrent runners could both observe no row and both send — the later
-- 23505 only prevented double-recording, not double-sending. The protocol
-- is now claim-first, mirroring the billing_events RECEIVED vs PROCESSED
-- split in lifecycle.ts:
-- - a runner INSERTs its claim (sent_at NULL, claimed_at = now) BEFORE
--   delivering. The UNIQUE (subscription_id, stage) guard makes exactly one
--   runner the owner; the loser re-reads the row instead of sending.
-- - the owner delivers, then UPDATEs sent_at. A crash between claim and
--   send leaves a stale claim (sent_at NULL, claimed_at past the lease in
--   DUNNING_SCHEDULE.claimLeaseMinutes) that the next run adopts — retries
--   the stage instead of suppressing it forever.
-- Residual tradeoff (documented in dunning.ts): a crash AFTER delivery but
-- BEFORE the sent_at update retries the send on adoption. Concurrent
-- runners can no longer double-send; only a crash mid-flight can, and the
-- mailer has no transactional idempotency to close that last gap.

alter table public.dunning_deliveries
  alter column sent_at drop not null,
  add column claimed_at timestamptz not null default now();

comment on column public.dunning_deliveries.sent_at is
  'Issue #265: NULL while a runner owns the claim (delivery in flight), set when the stage email goes out. Only non-NULL rows suppress a stage.';
comment on column public.dunning_deliveries.claimed_at is
  'Issue #265: when the current owner claimed the stage. A NULL-sent_at row older than the claim lease is adopted (re-sent) by the next run.';
