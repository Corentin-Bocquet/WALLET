-- ============================================================================
-- Shim minimal reproduisant les objets Supabase dont dépendent les migrations.
-- Sert UNIQUEMENT à valider le schéma sur un Postgres nu (CI, local).
-- Il n'est jamais appliqué sur le vrai projet Supabase.
-- ============================================================================
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls; end if;
end $$;

create table if not exists auth.users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text unique,
  raw_user_meta_data    jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

-- auth.uid() lit le claim JWT ; en local on lit un GUC que les tests posent.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select string_to_array(name, '/');
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
