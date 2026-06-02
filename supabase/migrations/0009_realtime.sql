-- Realtime: stream INSERTs on comments + shared_folders so the feed and
-- discussions update live. Adds the tables to the supabase_realtime publication
-- (guarded so re-running is safe). RLS still applies to realtime, so members
-- only receive rows they're allowed to read.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_folders'
  ) then
    alter publication supabase_realtime add table public.shared_folders;
  end if;
end $$;
