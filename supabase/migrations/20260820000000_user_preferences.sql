create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  number_format text not null default 'locale'
    check (number_format in ('locale', 'dot_decimal', 'comma_decimal')),
  locale text check (locale in ('es', 'en', 'pt-BR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_preferences_set_updated_at
  before update on public.user_preferences
  for each row execute function public.tg_set_updated_at();

drop view public.active_membership;

create view public.active_membership as
select
  m.id,
  m.household_id,
  m.user_id,
  m.role,
  m.display_name,
  m.joined_at,
  m.avatar_url,
  m.color_hex,
  m.removed_at,
  m.removed_by,
  m.removal_reason
from public.household_members m
join public.households h on h.id = m.household_id
where m.removed_at is null
  and h.deleted_at is null;

revoke all on public.active_membership from public, anon, authenticated;

insert into public.user_preferences (user_id, number_format)
select distinct on (user_id) user_id, number_format
from public.household_members
where removed_at is null
order by user_id, joined_at, id
on conflict (user_id) do nothing;

drop function if exists public.update_my_number_format(uuid, text);

alter table public.household_members
  drop column number_format;

create or replace function public.current_member(household uuid)
returns public.household_members
language sql
stable
security definer
set search_path = public
as $$
  select m.*
  from public.active_membership m
  where household_id = household
    and user_id = auth.uid()
  limit 1;
$$;

grant select, insert, update, delete on public.user_preferences to anon, authenticated;

alter table public.user_preferences enable row level security;

create policy user_preferences_select on public.user_preferences
  for select to authenticated using (user_id = auth.uid());

create policy user_preferences_insert on public.user_preferences
  for insert to authenticated with check (user_id = auth.uid());

create policy user_preferences_update on public.user_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_preferences_delete on public.user_preferences
  for delete to authenticated using (user_id = auth.uid());
