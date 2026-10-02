-- Attach the standard updated_at maintenance trigger to subscriptions.
-- Every other table carrying updated_at uses public.tg_set_updated_at();
-- without it the column goes stale on webhook-driven status/plan changes
-- unless each writer sets it manually (review follow-up on #257).

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.tg_set_updated_at();
