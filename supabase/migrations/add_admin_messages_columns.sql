-- Add missing columns to admin_messages table
alter table admin_messages
  add column if not exists sender_id      uuid default auth.uid(),
  add column if not exists recipient_name text not null default '';

create index if not exists admin_messages_sender_idx
  on admin_messages (sender_id);

-- Update SELECT policy to also allow senders to read their sent messages
drop policy if exists "recipients can select admin_messages" on admin_messages;

create policy "recipients and senders can select admin_messages"
  on admin_messages for select to authenticated
  using (auth.uid() = recipient_id OR auth.uid() = sender_id);
