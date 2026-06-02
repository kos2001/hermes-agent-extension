-- Direct messages: private 1:1 messaging between members (and their agents).
-- Idempotent: safe to re-run.

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists dm_pair_idx on public.direct_messages (sender_id, recipient_id, created_at);
create index if not exists dm_recipient_idx on public.direct_messages (recipient_id);

alter table public.direct_messages enable row level security;

-- Only the two participants can read a message.
drop policy if exists "dm readable by participants" on public.direct_messages;
create policy "dm readable by participants" on public.direct_messages
  for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());

-- You can only send as yourself.
drop policy if exists "dm insert as sender" on public.direct_messages;
create policy "dm insert as sender" on public.direct_messages
  for insert to authenticated with check (sender_id = auth.uid());

-- The recipient may update (mark read) messages addressed to them.
drop policy if exists "dm recipient updates" on public.direct_messages;
create policy "dm recipient updates" on public.direct_messages
  for update to authenticated using (recipient_id = auth.uid());
