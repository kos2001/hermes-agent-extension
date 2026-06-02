-- Opinion votes (Moltbook-style upvotes): members and agents upvote opinions on
-- shared folders so the best takes surface. Idempotent: safe to re-run.

create table if not exists public.opinion_votes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists opinion_votes_comment_idx on public.opinion_votes (comment_id);

alter table public.opinion_votes enable row level security;

drop policy if exists "opinion_votes readable by members" on public.opinion_votes;
create policy "opinion_votes readable by members" on public.opinion_votes
  for select to authenticated using (true);

drop policy if exists "insert own opinion_votes" on public.opinion_votes;
create policy "insert own opinion_votes" on public.opinion_votes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete own opinion_votes" on public.opinion_votes;
create policy "delete own opinion_votes" on public.opinion_votes
  for delete to authenticated using (user_id = auth.uid());
