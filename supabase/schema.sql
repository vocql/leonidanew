-- VOQCL TOOLS - Supabase schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).

-- ---------- profiles (one per account; public bio page at voqcl.com/bio/<username>) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  published   boolean not null default false,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,24}$'),
  constraint username_not_reserved check (username not in ('admin','api','bio','u','assets','css','js','live','tool','tools','account','reset','login','register','support','help','voqcl_admin')),
  constraint data_size check (pg_column_size(data) < 200000)
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: public can read published" on public.profiles;
create policy "profiles: public can read published" on public.profiles
  for select using (published or auth.uid() = id);

drop policy if exists "profiles: owner can update" on public.profiles;
create policy "profiles: owner can update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles: owner can insert own row" on public.profiles;
create policy "profiles: owner can insert own row" on public.profiles
  for insert with check (auth.uid() = id);

-- keep updated_at current
create or replace function public.touch_profile() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_profile();

-- create the profile row automatically when someone signs up (username comes from sign-up metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, data)
  values (new.id, lower(new.raw_user_meta_data ->> 'username'), '{}'::jsonb);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- username availability check (reveals only whether a name is taken, nothing else)
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(u) ~ '^[a-z0-9_]{3,24}$'
     and lower(u) not in ('admin','api','bio','u','assets','css','js','live','tool','tools','account','reset','login','register','support','help','voqcl_admin')
     and not exists (select 1 from public.profiles where username = lower(u));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------- storage bucket for profile pictures, banners and backgrounds ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bio', 'bio', true, 3145728, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists "bio: public read" on storage.objects;
create policy "bio: public read" on storage.objects for select using (bucket_id = 'bio');

drop policy if exists "bio: upload to own folder" on storage.objects;
create policy "bio: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'bio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "bio: delete own files" on storage.objects;
create policy "bio: delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'bio' and (storage.foldername(name))[1] = auth.uid()::text);
