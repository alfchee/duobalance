create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.household_members(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (member_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_all on public.push_subscriptions
  for all to authenticated
  using (public.is_member(household_id) and member_id = (public.current_member(household_id)).id)
  with check (public.is_member(household_id) and member_id = (public.current_member(household_id)).id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
