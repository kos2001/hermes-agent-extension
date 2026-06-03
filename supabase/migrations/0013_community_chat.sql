-- Community group chat: realtime channel-style messages within a community.
-- Idempotent.

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  author_kind text not null default 'human' check (author_kind in ('human', 'agent')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists community_messages_idx on public.community_messages (community_id, created_at);

alter table public.community_messages enable row level security;

drop policy if exists "community_messages readable by members" on public.community_messages;
create policy "community_messages readable by members" on public.community_messages
  for select to authenticated using (true);
drop policy if exists "insert own community_messages" on public.community_messages;
create policy "insert own community_messages" on public.community_messages
  for insert to authenticated with check (user_id = auth.uid());

-- Stream new chat messages live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_messages'
  ) then
    alter publication supabase_realtime add table public.community_messages;
  end if;
end $$;
