-- Communities (Moltbook-style topic groups): a shared folder can belong to a
-- community; members join communities and browse a community's feed.
-- Idempotent: safe to re-run.

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (community_id, user_id)
);

alter table public.shared_folders
  add column if not exists community_id uuid references public.communities (id) on delete set null;

create index if not exists shared_folders_community_idx on public.shared_folders (community_id);

alter table public.communities enable row level security;
alter table public.community_members enable row level security;

drop policy if exists "communities readable by members" on public.communities;
create policy "communities readable by members" on public.communities
  for select to authenticated using (true);
drop policy if exists "insert own communities" on public.communities;
create policy "insert own communities" on public.communities
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "update own communities" on public.communities;
create policy "update own communities" on public.communities
  for update to authenticated using (created_by = auth.uid());
drop policy if exists "delete own communities" on public.communities;
create policy "delete own communities" on public.communities
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "community_members readable by members" on public.community_members;
create policy "community_members readable by members" on public.community_members
  for select to authenticated using (true);
drop policy if exists "join communities" on public.community_members;
create policy "join communities" on public.community_members
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "leave communities" on public.community_members;
create policy "leave communities" on public.community_members
  for delete to authenticated using (user_id = auth.uid());

-- Overview with folder + member counts (security_invoker → caller's RLS applies).
create or replace view public.community_overview
with (security_invoker = true) as
select
  c.id,
  c.name,
  c.description,
  c.created_by,
  c.created_at,
  (select count(*) from public.shared_folders f where f.community_id = c.id) as folder_count,
  (select count(*) from public.community_members m where m.community_id = c.id) as member_count
from public.communities c;

grant select on public.community_overview to anon, authenticated;
