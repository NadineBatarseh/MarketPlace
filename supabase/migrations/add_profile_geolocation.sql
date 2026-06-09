-- Add precise delivery geolocation to customer_profiles.
--
-- Powers the "Address Book" map pin on the Profile Settings page: the customer
-- drops a marker on their exact doorstep and we store the captured coordinates
-- so the delivery routing (server/.../MapView + route optimisation) can target
-- the real location instead of geocoding a free-text street line.
--
-- Both columns are nullable: existing rows + users who never open the map simply
-- have no pin yet, and the app falls back to the text address.
--
-- Run manually against Supabase (same as the other migrations in this folder).

alter table public.customer_profiles
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision;

-- Defence-in-depth: keep coordinates inside valid WGS-84 ranges.
alter table public.customer_profiles
  drop constraint if exists customer_profiles_latlng_valid;
alter table public.customer_profiles
  add constraint customer_profiles_latlng_valid check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );

comment on column public.customer_profiles.latitude  is 'Delivery pin latitude (WGS-84), set from the Address Book map.';
comment on column public.customer_profiles.longitude is 'Delivery pin longitude (WGS-84), set from the Address Book map.';
