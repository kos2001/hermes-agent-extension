-- Threaded replies: a comment may reply to another comment (one level deep in
-- the UI). NULL parent_id = a top-level opinion. Idempotent.

alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;

create index if not exists comments_parent_idx on public.comments (parent_id);
