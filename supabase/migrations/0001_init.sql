-- Hive platform foundation (sub-project A): schema, RLS, profile trigger.
-- Apply via the Supabase SQL editor or `supabase db push`.

-- profiles: one row per auth user, auto-created on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.shared_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  source_folder_name text not null,
  summary text,
  topics text[] not null default '{}',
  item_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, source_folder_name)
);

create table public.shared_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.shared_folders (id) on delete cascade,
  title text not null,
  url text not null,
  item_summary text,
  position int not null default 0
);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.shared_folders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('like', 'save')),
  created_at timestamptz not null default now(),
  unique (folder_id, user_id, kind)
);

-- Auto-create a profile row when a new auth user appears.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row-Level Security: public read for members, own-row writes.
alter table public.profiles enable row level security;
alter table public.shared_folders enable row level security;
alter table public.shared_items enable row level security;
alter table public.reactions enable row level security;

create policy "profiles readable by members" on public.profiles
  for select to authenticated using (true);
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid());

create policy "folders readable by members" on public.shared_folders
  for select to authenticated using (true);
create policy "insert own folders" on public.shared_folders
  for insert to authenticated with check (owner_id = auth.uid());
create policy "update own folders" on public.shared_folders
  for update to authenticated using (owner_id = auth.uid());
create policy "delete own folders" on public.shared_folders
  for delete to authenticated using (owner_id = auth.uid());

create policy "items readable by members" on public.shared_items
  for select to authenticated using (true);
create policy "write items of own folders" on public.shared_items
  for all to authenticated
  using (exists (select 1 from public.shared_folders f
                 where f.id = folder_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.shared_folders f
                      where f.id = folder_id and f.owner_id = auth.uid()));

create policy "reactions readable by members" on public.reactions
  for select to authenticated using (true);
create policy "insert own reactions" on public.reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "delete own reactions" on public.reactions
  for delete to authenticated using (user_id = auth.uid());
