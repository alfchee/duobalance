alter table public.household_members
  add column number_format text not null default 'locale'
    check (number_format in ('locale', 'dot_decimal', 'comma_decimal'));

create function public.update_my_number_format(member_id uuid, new_number_format text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_number_format not in ('locale', 'dot_decimal', 'comma_decimal') then
    raise exception 'invalid number format';
  end if;

  update public.household_members
  set number_format = new_number_format
  where id = member_id and user_id = auth.uid();

  if not found then
    raise exception 'membership not found';
  end if;
end;
$$;

revoke all on function public.update_my_number_format(uuid, text) from public;
grant execute on function public.update_my_number_format(uuid, text) to authenticated;
