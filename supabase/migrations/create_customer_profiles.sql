-- Customer Profiles — per-user profile + default shipping address.
--
-- A dedicated 1:1 table keyed by the auth user id (public.Users.user_id /
-- auth.users.id). Kept SEPARATE from public.Users so auth/role data stays clean
-- and shipping data lives on its own. Powers:
--   * the "User Profile Settings" page (GET/PUT /api/profile), and
--   * checkout auto-fill + "save as default address" on order placement.
--
-- Reads/writes go through the Express API (server/routes/profileRouter.ts) using
-- the service-role key, which BYPASSES RLS. The owner-scoped policies below are a
-- defence-in-depth layer so that even a direct anon-key client can only ever see
-- or modify its OWN row.

create table if not exists public.customer_profiles (
  user_id      uuid primary key
                 references auth.users (id) on delete cascade,
  first_name   text,
  last_name    text,
  phone        text,
  city         text,
  street       text,        -- street name + house number (the main address line)
  apartment    text,        -- apartment / floor (optional)
  postal_code  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Keep updated_at fresh on every write.
create or replace function public.touch_customer_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
  before update on public.customer_profiles
  for each row execute function public.touch_customer_profiles_updated_at();

-- ── RLS: owner-scoped (service role bypasses these entirely) ──────────
alter table public.customer_profiles enable row level security;

drop policy if exists customer_profiles_select_own on public.customer_profiles;
drop policy if exists customer_profiles_insert_own on public.customer_profiles;
drop policy if exists customer_profiles_update_own on public.customer_profiles;

create policy customer_profiles_select_own on public.customer_profiles
  for select to authenticated using (auth.uid() = user_id);
create policy customer_profiles_insert_own on public.customer_profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy customer_profiles_update_own on public.customer_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- no DELETE policy → client DELETE denied; lifecycle handled by ON DELETE CASCADE
