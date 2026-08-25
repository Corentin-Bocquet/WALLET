-- ============================================================================
-- WALLET · 0001 · Extensions, identité, préférences
-- ============================================================================
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- Helper : timestamp de mise à jour automatique -------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles : 1 ligne par utilisateur authentifié ------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique,
  full_name     text,
  avatar_path   text,                       -- chemin dans le bucket Storage "avatars"
  locale        text not null default 'fr',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint username_format check (
    username is null or username ~ '^[a-zA-Z0-9_\-\.]{3,32}$'
  )
);

-- user_settings : tout ce qui est personnalisable (§35) ------------------------
create table if not exists public.user_settings (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  base_currency      text not null default 'EUR',
  locale             text not null default 'fr-FR',
  theme              text not null default 'dark'   check (theme in ('dark','light','system')),
  ui_mode            text not null default 'simple' check (ui_mode in ('simple','advanced')),
  sound_enabled      boolean not null default true,
  haptics_enabled    boolean not null default true,
  privacy_blur       boolean not null default false,
  notifications      jsonb not null default '{"price":true,"score":true,"budget":true,"sync":true}'::jsonb,
  engine_params      jsonb not null default '{}'::jsonb,
  dashboard_layout   jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Provisionnement automatique à l'inscription ---------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(regexp_replace(split_part(coalesce(new.email,''), '@', 1), '[^a-zA-Z0-9_\-\.]', '', 'g'), '')
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists touch_profiles on public.profiles;
create trigger touch_profiles before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_user_settings on public.user_settings;
create trigger touch_user_settings before update on public.user_settings
  for each row execute function public.touch_updated_at();
