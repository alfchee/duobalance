-- Fix for 20260911000000 review: anon grant was temporarily removed,
-- but pgTAP authenticate_anon() requires SELECT grant to get empty via RLS
-- rather than permission denied. Re-align with feedback_submissions pattern.

grant select, insert on public.guide_opens to anon;
