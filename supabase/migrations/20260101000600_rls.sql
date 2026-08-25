-- ============================================================================
-- WALLET · 0006 · Row Level Security
--   Principe : par défaut, personne ne voit rien. Chaque table personnelle
--   n'est lisible/modifiable que par son propriétaire (auth.uid()).
--   Le référentiel de marché est en lecture seule pour les authentifiés et
--   n'est écrit que par le service_role (Edge Functions).
-- ============================================================================

-- 1. Tables personnelles : owner-only, 4 opérations -------------------------
do $$
declare tbl text;
declare owner_tables text[] := array[
  'user_settings','accounts','provider_credentials','holdings','portfolio_snapshots',
  'asset_watchlist','investment_transactions','categories','bank_transactions',
  'category_rules','category_corrections','category_memory','ignore_memory',
  'recurring_transactions','import_batches','score_models','investment_scores',
  'scenarios','alt_ratios','goals','alerts','alert_events','insights','backtests',
  'assistant_messages'
];
declare col text;
begin
  foreach tbl in array owner_tables loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('alter table public.%I force row level security;', tbl);

    -- user_settings utilise user_id ; toutes les autres aussi (choix volontaire)
    col := 'user_id';

    execute format('drop policy if exists "%1$s_select" on public.%1$I;', tbl);
    execute format($p$create policy "%1$s_select" on public.%1$I
                     for select to authenticated using (%2$I = (select auth.uid()));$p$, tbl, col);

    execute format('drop policy if exists "%1$s_insert" on public.%1$I;', tbl);
    execute format($p$create policy "%1$s_insert" on public.%1$I
                     for insert to authenticated with check (%2$I = (select auth.uid()));$p$, tbl, col);

    execute format('drop policy if exists "%1$s_update" on public.%1$I;', tbl);
    execute format($p$create policy "%1$s_update" on public.%1$I
                     for update to authenticated
                     using (%2$I = (select auth.uid()))
                     with check (%2$I = (select auth.uid()));$p$, tbl, col);

    execute format('drop policy if exists "%1$s_delete" on public.%1$I;', tbl);
    execute format($p$create policy "%1$s_delete" on public.%1$I
                     for delete to authenticated using (%2$I = (select auth.uid()));$p$, tbl, col);
  end loop;
end $$;

-- 2. profiles : clé primaire = id ------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- 3. provider_credentials : le client ne doit JAMAIS lire le ciphertext ------
--    On retire le SELECT direct et on ne laisse que la vue "safe".
drop policy if exists "provider_credentials_select" on public.provider_credentials;
create policy "provider_credentials_select_safe" on public.provider_credentials
  for select to authenticated
  using (user_id = (select auth.uid()) and false);   -- aucune lecture directe
-- La lecture passe par la vue security_invoker + la fonction RPC ci-dessous,
-- ou par les Edge Functions en service_role (qui contournent la RLS).

create or replace function public.list_provider_credentials()
returns table (id uuid, provider text, label text, scope text,
               fingerprint text, last_used_at timestamptz, last_error text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.provider, c.label, c.scope, c.fingerprint, c.last_used_at, c.last_error, c.created_at
  from public.provider_credentials c
  where c.user_id = auth.uid()
  order by c.created_at desc;
$$;
revoke all on function public.list_provider_credentials() from public;
grant execute on function public.list_provider_credentials() to authenticated;

-- 4. Référentiel de marché : lecture pour tous les authentifiés ------------
do $$
declare tbl text;
declare public_tables text[] := array[
  'assets','asset_quotes','price_history','market_indicators','fx_rates','glossary'
];
begin
  foreach tbl in array public_tables loop
    execute format('alter table public.%I enable row level security;', tbl);
    execute format('drop policy if exists "%1$s_read" on public.%1$I;', tbl);
    execute format($p$create policy "%1$s_read" on public.%1$I
                     for select to authenticated using (true);$p$, tbl);
  end loop;
end $$;

-- 5. sync_state : global lisible, personnel owner-only ----------------------
alter table public.sync_state enable row level security;
drop policy if exists "sync_state_read" on public.sync_state;
create policy "sync_state_read" on public.sync_state
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

-- 6. Storage : bucket privé "avatars", 1 dossier par utilisateur ------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 10485760,
        array['text/csv','text/plain','application/x-ofx','application/json'])
on conflict (id) do nothing;

do $$
declare b text;
begin
  foreach b in array array['avatars','imports'] loop
    execute format('drop policy if exists "%1$s_rw" on storage.objects;', b);
    execute format($p$create policy "%1$s_rw" on storage.objects
       for all to authenticated
       using (bucket_id = %1$L and (storage.foldername(name))[1] = (select auth.uid())::text)
       with check (bucket_id = %1$L and (storage.foldername(name))[1] = (select auth.uid())::text);$p$, b);
  end loop;
end $$;
