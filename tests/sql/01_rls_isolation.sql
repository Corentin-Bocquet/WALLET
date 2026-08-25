-- ============================================================================
-- TEST · Isolation RLS : Alice ne doit jamais voir les données de Bob.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages to warning;

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.test');

-- Le trigger a créé profils + settings ---------------------------------------
do $$
begin
  assert (select count(*) from public.profiles) = 2,      'profils non provisionnés';
  assert (select count(*) from public.user_settings) = 2, 'settings non provisionnés';
end $$;

-- Alice ----------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

select public.seed_user_defaults();

insert into public.accounts (user_id, kind, provider, label)
values ('11111111-1111-1111-1111-111111111111', 'bank', 'boursorama', 'Compte Alice');

do $$
begin
  assert (select count(*) from public.accounts) = 1, 'Alice devrait voir son compte';
  assert (select count(*) from public.categories) > 20, 'catégories par défaut manquantes';
end $$;

-- Alice ne peut pas écrire pour Bob ------------------------------------------
do $$
begin
  begin
    insert into public.accounts (user_id, kind, provider, label)
    values ('22222222-2222-2222-2222-222222222222', 'bank', 'x', 'Piraté');
    raise exception 'FAIL: Alice a pu écrire une ligne appartenant à Bob';
  exception when insufficient_privilege then
    null;  -- comportement attendu
  end;
end $$;

-- Bob ------------------------------------------------------------------------
set local "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

do $$
begin
  assert (select count(*) from public.accounts) = 0,
         'FAIL: Bob voit les comptes d''Alice';
  assert (select count(*) from public.categories) = 0,
         'FAIL: Bob voit les catégories d''Alice';
end $$;

-- Le référentiel public reste lisible par tous les connectés ------------------
do $$
begin
  assert (select count(*) from public.glossary) >= 10, 'glossaire vide';
end $$;

-- Personne ne lit provider_credentials directement ----------------------------
do $$
begin
  begin
    perform 1 from public.provider_credentials;
    raise exception 'FAIL: provider_credentials lisible directement';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
rollback;

\echo '  ✓ isolation RLS'
