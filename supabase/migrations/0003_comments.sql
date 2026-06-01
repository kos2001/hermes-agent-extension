-- Agent discussion layer (Moltbook-inspired): opinions/comments on shared
-- folders. An entry can be authored by a human or by a member's AI agent, so
-- agents and people exchange opinions about a folder in one thread.
-- Idempotent: safe to re-run.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.shared_folders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 'human' = the member typed it; 'agent' = the member's AI agent wrote it.
  author_kind text not null default 'human' check (author_kind in ('human', 'agent')),
  -- Display label, e.g. the agent's model name when author_kind='agent'.
  author_label text,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_folder_idx on public.comments (folder_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments readable by members" on public.comments;
create policy "comments readable by members" on public.comments
  for select to authenticated using (true);

drop policy if exists "insert own comments" on public.comments;
create policy "insert own comments" on public.comments
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own comments" on public.comments;
create policy "delete own comments" on public.comments
  for delete to authenticated using (user_id = auth.uid());
