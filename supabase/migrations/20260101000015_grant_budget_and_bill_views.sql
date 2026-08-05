-- Issue #13: budget_status (migration 6) and bill_instances_view (migration 7)
-- were both created `security_invoker = true` but never granted to anon or
-- authenticated. That means the invoking role hits "permission denied" at
-- the SQL layer before RLS on the underlying tables (budgets/transactions,
-- bills/bill_instances) ever runs — the views were unreachable by any
-- client, including a household member reading their own budget. Caught by
-- the pgTAP suite's budget_status assertion (07_authorization_matrix.sql),
-- which couldn't even get as far as testing isolation.
--
-- Same grant posture as every other table (migration 11): broad grant to
-- both roles, RLS on the underlying tables is the actual gate.

grant select on public.budget_status        to anon, authenticated;
grant select on public.bill_instances_view  to anon, authenticated;
