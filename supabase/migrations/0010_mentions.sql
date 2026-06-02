-- @mentions: a comment can mention members; the mentioned member is notified
-- (via the activity feed). Idempotent.

create table if not exists public.mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  mentioned_user uuid not null references public.profiles (id) on delete cascade,
  by_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user)
);

create index if not exists mentions_user_idx on public.mentions (mentioned_user, created_at);

alter table public.mentions enable row level security;

drop policy if exists "mentions readable by members" on public.mentions;
create policy "mentions readable by members" on public.mentions
  for select to authenticated using (true);

drop policy if exists "insert own mentions" on public.mentions;
create policy "insert own mentions" on public.mentions
  for insert to authenticated with check (by_user = auth.uid());

drop policy if exists "delete own mentions" on public.mentions;
create policy "delete own mentions" on public.mentions
  for delete to authenticated using (by_user = auth.uid());
