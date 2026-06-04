-- Allow unauthenticated users to upload to merchant-id-docs bucket
-- (merchant applicants are not logged in when they submit)
insert into storage.buckets (id, name, public)
  values ('merchant-id-docs', 'merchant-id-docs', false)
  on conflict (id) do nothing;

create policy "anon_insert_merchant_id_docs"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'merchant-id-docs');

create policy "auth_select_merchant_id_docs"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'merchant-id-docs');

-- Same for delivery-applications bucket
insert into storage.buckets (id, name, public)
  values ('delivery-applications', 'delivery-applications', false)
  on conflict (id) do nothing;

create policy "anon_insert_delivery_applications"
  on storage.objects for insert
  to anon
  with check (bucket_id = 'delivery-applications');

create policy "auth_select_delivery_applications"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'delivery-applications');
