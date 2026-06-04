-- Archive System — RLS lockdown for the destructive-delete vulnerability.
--
-- PROBLEM: admin "delete" actions ran from the browser with the anon API key,
-- and RLS was permissive, so ANY client could delete shops / couriers /
-- applications. Archive (recoverable, audit-tracked) replaces these deletes and
-- runs SERVER-SIDE with the service-role key, which BYPASSES RLS entirely.
--
-- THEREFORE this migration:
--   * enables RLS on the archivable admin tables,
--   * preserves every existing client flow: SELECT (storefront/guests),
--     INSERT (application signups, merchant shop creation),
--     UPDATE (suspend, merchant shop edit, driver location, admin approve),
--   * grants NO DELETE policy → client DELETE is denied for anon AND
--     authenticated roles. The only path that can mutate these as "archive"
--     is the server (service role).
--
-- NOTE: tighter role/ownership-scoped UPDATE policies (e.g. only the owning
-- merchant or an admin may update a shop) are intentionally deferred — see the
-- plan's "Postponed" section. This migration's scope is closing the delete hole
-- without breaking any current flow.
--
-- Run against staging first and verify storefront reads + signup still work.

-- ============ shops ============
alter table public.shops enable row level security;

drop policy if exists shops_select_all       on public.shops;
drop policy if exists shops_insert_auth       on public.shops;
drop policy if exists shops_update_auth        on public.shops;

create policy shops_select_all on public.shops
  for select to anon, authenticated using (true);
create policy shops_insert_auth on public.shops
  for insert to authenticated with check (true);
create policy shops_update_auth on public.shops
  for update to authenticated using (true) with check (true);
-- no DELETE policy → deletes denied for client roles

-- ============ couriers ============
alter table public.couriers enable row level security;

drop policy if exists couriers_select_all  on public.couriers;
drop policy if exists couriers_update_auth on public.couriers;

create policy couriers_select_all on public.couriers
  for select to anon, authenticated using (true);
create policy couriers_update_auth on public.couriers
  for update to authenticated using (true) with check (true);
-- couriers are created server-side (service role) on activation → no client INSERT
-- no DELETE policy → deletes denied for client roles

-- ============ merchant_applications ============
alter table public.merchant_applications enable row level security;

drop policy if exists merchant_apps_select_all  on public.merchant_applications;
drop policy if exists merchant_apps_insert_any  on public.merchant_applications;
drop policy if exists merchant_apps_update_auth on public.merchant_applications;

-- applicants are NOT logged in when they submit → anon must be able to insert
create policy merchant_apps_insert_any on public.merchant_applications
  for insert to anon, authenticated with check (true);
create policy merchant_apps_select_all on public.merchant_applications
  for select to anon, authenticated using (true);
create policy merchant_apps_update_auth on public.merchant_applications
  for update to authenticated using (true) with check (true);
-- no DELETE policy → admin "delete" is replaced by server-side archive

-- ============ delivery_applications ============
alter table public.delivery_applications enable row level security;

drop policy if exists delivery_apps_select_all  on public.delivery_applications;
drop policy if exists delivery_apps_insert_any  on public.delivery_applications;
drop policy if exists delivery_apps_update_auth on public.delivery_applications;

create policy delivery_apps_insert_any on public.delivery_applications
  for insert to anon, authenticated with check (true);
create policy delivery_apps_select_all on public.delivery_applications
  for select to anon, authenticated using (true);
create policy delivery_apps_update_auth on public.delivery_applications
  for update to authenticated using (true) with check (true);
-- no DELETE policy

-- ============ hubworker_applications ============
alter table public.hubworker_applications enable row level security;

drop policy if exists hubworker_apps_select_all  on public.hubworker_applications;
drop policy if exists hubworker_apps_insert_any  on public.hubworker_applications;
drop policy if exists hubworker_apps_update_auth on public.hubworker_applications;

create policy hubworker_apps_insert_any on public.hubworker_applications
  for insert to anon, authenticated with check (true);
create policy hubworker_apps_select_all on public.hubworker_applications
  for select to anon, authenticated using (true);
create policy hubworker_apps_update_auth on public.hubworker_applications
  for update to authenticated using (true) with check (true);
-- no DELETE policy
