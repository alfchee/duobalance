create or replace function public.tg_transactions_authorize_transfer_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.transfer_group_id is not null and exists (
    select 1
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    where t.transfer_group_id = old.transfer_group_id
      and t.household_id = old.household_id
      and not (
        a.is_shared
        or a.owner_member_id = public.current_member_id(a.household_id)
      )
  ) then
    raise exception 'cannot delete a transfer with an inaccessible account'
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

create trigger transactions_authorize_transfer_delete
before delete on public.transactions
for each row execute function public.tg_transactions_authorize_transfer_delete();
