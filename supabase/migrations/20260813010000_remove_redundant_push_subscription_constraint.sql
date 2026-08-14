alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_member_id_endpoint_key;
