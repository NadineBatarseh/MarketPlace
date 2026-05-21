create table if not exists admin_messages (
  id             uuid        primary key default gen_random_uuid(),
  sender_id      uuid        default auth.uid(),
  recipient_id   uuid        not null,
  recipient_name text        not null default '',
  subject        text        not null,
  body           text,
  read_at        timestamptz,
  created_at     timestamptz default now()
);

create index if not exists admin_messages_recipient_idx
  on admin_messages (recipient_id);

create index if not exists admin_messages_sender_idx
  on admin_messages (sender_id);

alter table admin_messages enable row level security;

-- Admin (any authenticated user) can insert messages
create policy "authenticated can insert admin_messages"
  on admin_messages for insert to authenticated
  with check (true);

-- Recipients can read their own messages
create policy "recipients can select admin_messages"
  on admin_messages for select to authenticated
  using (auth.uid() = recipient_id OR auth.uid() = sender_id);

-- Recipients can mark their messages as read
create policy "recipients can update admin_messages"
  on admin_messages for update to authenticated
  using (auth.uid() = recipient_id);
