-- Issue #15: email-send rate limiting for the invite flow.
--
-- POST /api/invites is the one endpoint a stranger can indirectly cause
-- traffic to (each call triggers an email via Resend). The cap is enforced
-- in the database rather than in the route handler so it survives serverless
-- cold starts and can be exercised by pgTAP. The route handler simply
-- INSERTs a row before sending; a trigger rejects the 11th send within an
-- hour with a distinct error the handler maps to HTTP 429.
--
-- The table deliberately has NO grant for anon/authenticated (migration 11's
-- grant list is static and doesn't include it) and RLS is on with no
-- policies — the only writer is the service role (route handler) or the
-- postgres superuser (tests). invite_sends is an audit/limit table, not
-- household data, so it must never be reachable through the data API.

create table public.invite_sends (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid        not null references auth.users(id) on delete cascade,
  sent_at  timestamptz not null default now()
);

create index invite_sends_user_idx on public.invite_sends (user_id, sent_at desc);

-- The route handler (app/api/invites/**) writes this table with the service
-- role key. New tables aren't auto-exposed in this project (see config.toml
-- `api.auto_expose_new_tables`), so grant service_role explicitly. anon and
-- authenticated get nothing.
grant select, insert, delete on public.invite_sends to service_role;

comment on table public.invite_sends is
  'One row per invite email send attempt. The trigger caps sends per user per hour (#15).';

-- ============================================================================
-- Rate limit: 10 sends / hour / user. Runs BEFORE INSERT so the 11th send in
-- the window is rejected outright (no row is written). Also prunes rows older
-- than 24h opportunistically — the table only needs the current window plus
-- history long enough to count the cap, so old rows are dead weight.
--
-- The count-then-reject trigger is not serialized against concurrent inserts
-- (two sends racing the same window can both pass the count), so it is a
-- best-effort spam guard, not a hard invariant. That's acceptable here: the
-- cost of an occasional overshoot is a couple of extra emails, not data
-- corruption.
-- ============================================================================

create or replace function public.tg_limit_invite_sends()
returns trigger
language plpgsql
as $$
begin
  delete from public.invite_sends
  where sent_at < now() - interval '24 hours';

  if exists (
    select 1 from public.invite_sends
    where user_id = new.user_id
      and sent_at > now() - interval '1 hour'
    limit 10
    offset 9
  ) then
    raise exception 'invite rate limit exceeded';
  end if;

  return new;
end;
$$;

create trigger invite_sends_limit
  before insert on public.invite_sends
  for each row execute function public.tg_limit_invite_sends();

alter table public.invite_sends enable row level security;
-- No policies: RLS denies everything for roles that have no grant; the
-- service role (route handler) and postgres (tests) bypass RLS anyway.
