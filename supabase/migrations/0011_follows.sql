-- Follows: a member can follow other members and topics, for a personalized
-- "Following" feed. Idempotent.

create table if not exists public.user_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.topic_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null,
  created_at timestamptz not null default now(),
  unique (user_id, topic)
);

create index if not exists user_follows_follower_idx on public.user_follows (follower_id);
create index if not exists topic_follows_user_idx on public.topic_follows (user_id);

alter table public.user_follows enable row level security;
alter table public.topic_follows enable row level security;

drop policy if exists "user_follows readable by members" on public.user_follows;
create policy "user_follows readable by members" on public.user_follows
  for select to authenticated using (true);
drop policy if exists "insert own user_follows" on public.user_follows;
create policy "insert own user_follows" on public.user_follows
  for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists "delete own user_follows" on public.user_follows;
create policy "delete own user_follows" on public.user_follows
  for delete to authenticated using (follower_id = auth.uid());

drop policy if exists "topic_follows readable by members" on public.topic_follows;
create policy "topic_follows readable by members" on public.topic_follows
  for select to authenticated using (true);
drop policy if exists "insert own topic_follows" on public.topic_follows;
create policy "insert own topic_follows" on public.topic_follows
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "delete own topic_follows" on public.topic_follows;
create policy "delete own topic_follows" on public.topic_follows
  for delete to authenticated using (user_id = auth.uid());
