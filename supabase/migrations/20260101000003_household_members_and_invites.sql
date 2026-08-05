-- Membership and invite tables. Both reference households.
-- household_members.user_id references auth.users (Supabase managed).

create table public.household_members (
  id            uuid                          primary key default gen_random_uuid(),
  household_id  uuid                          not null references public.households(id) on delete cascade,
  user_id       uuid                          not null references auth.users(id) on delete cascade,
  role          public.household_member_role  not null,
  display_name  text                          not null check (char_length(display_name) between 1 and 80),
  joined_at     timestamptz                   not null default now(),
  -- A user can only be a member of a given household once.
  unique (household_id, user_id)
);

create index household_members_user_idx       on public.household_members (user_id);
create index household_members_household_idx  on public.household_members (household_id);

comment on table public.household_members is 'Joins auth.users to households. The owner role is unique per household (enforced in RLS-friendly way below).';

create table public.household_invites (
  id             uuid                         primary key default gen_random_uuid(),
  household_id   uuid                         not null references public.households(id) on delete cascade,
  email          text                         not null check (email = lower(email)),  -- normalize on insert
  token          text                         not null unique default encode(gen_random_bytes(24), 'hex'),
  role           public.household_member_role not null,
  invited_by     uuid                         not null references public.household_members(id) on delete restrict,
  expires_at     timestamptz                  not null default (now() + interval '7 days'),
  accepted_at    timestamptz,
  created_at     timestamptz                  not null default now()
);

create index household_invites_household_idx on public.household_invites (household_id);
create index household_invites_email_idx     on public.household_invites (lower(email));

comment on table public.household_invites is 'Email-based invites. Resend sends the URL with `token` (#15).';
