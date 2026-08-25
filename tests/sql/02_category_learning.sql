-- ============================================================================
-- TEST · Apprentissage des catégories (§10, §11, §12, §13)
--   Scénario : « BIÈRE BAR X » classé Alcool, corrigé en Restaurants.
--   Le mois suivant, la même transaction doit tomber dans Restaurants.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages to warning;
begin;

insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'test@example.test');

set local role authenticated;
set local "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
select public.seed_user_defaults();

-- Normalisation des libellés --------------------------------------------------
do $$
declare n text;
begin
  n := public.normalize_label('CB CARREFOUR MARKET 4521 12/03/26');
  assert n = 'carrefour market', format('normalize_label a rendu "%s"', n);

  n := public.normalize_label('VIR SEPA Salaire Février');
  assert n = 'salaire fevrier', format('accents non gérés: "%s"', n);
end $$;

-- Seaux de montant (gestion des exceptions §12) -------------------------------
do $$
begin
  assert public.amount_bucket(-4.50)  = 'micro';
  assert public.amount_bucket(-24.00) = 'small';
  assert public.amount_bucket(-89.00) = 'medium';
  assert public.amount_bucket(-250.0) = 'large';
  assert public.amount_bucket(-980.0) = 'xl';
end $$;

-- Mise en place ---------------------------------------------------------------
insert into public.accounts (id, user_id, kind, provider, label)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333', 'bank', 'boursorama', 'Courant');

-- Mois 1 : la transaction arrive classée « Alcool » par heuristique
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, category_confidence, fingerprint)
select '33333333-3333-3333-3333-333333333333',
       'aaaaaaaa-0000-0000-0000-000000000001',
       date '2026-01-12', -18.40, 'CB BIERE BAR X 12/01', 'biere bar x', 'biere bar x',
       c.id, 'heuristic', 0.55, 'fp-mois1'
  from public.categories c
 where c.user_id = '33333333-3333-3333-3333-333333333333' and c.slug = 'alcool';

-- L'utilisateur corrige : Alcool → Restaurants -------------------------------
select public.apply_category_correction(
  (select id from public.bank_transactions where fingerprint = 'fp-mois1'),
  (select id from public.categories
    where user_id = '33333333-3333-3333-3333-333333333333' and slug = 'restaurant'),
  false);

do $$
declare v_src text; v_conf numeric; v_slug text; v_hits int;
begin
  select t.category_source, t.category_confidence, c.slug
    into v_src, v_conf, v_slug
    from public.bank_transactions t join public.categories c on c.id = t.category_id
   where t.fingerprint = 'fp-mois1';

  assert v_slug = 'restaurant', format('catégorie non appliquée: %s', v_slug);
  assert v_src  = 'user',       'la source doit devenir "user"';
  assert v_conf = 1.0,          'la confiance doit être maximale';

  assert (select count(*) from public.category_corrections) = 1,
         'la correction n''est pas journalisée';

  -- mémoire ciblée : 3 hits sur le seau "small" (18,40 €)
  select m.hits into v_hits
    from public.category_memory m join public.categories c on c.id = m.category_id
   where m.key_value = 'biere bar x' and m.amount_bucket = 'small' and c.slug = 'restaurant';
  assert v_hits = 3, format('mémoire ciblée absente ou faible (hits=%s)', v_hits);

  -- mémoire généralisée : 1 hit sur "any"
  assert exists (
    select 1 from public.category_memory m join public.categories c on c.id = m.category_id
     where m.key_value = 'biere bar x' and m.amount_bucket = 'any' and c.slug = 'restaurant'),
    'mémoire généralisée absente';
end $$;

-- Mois 2 : même marchand → la mémoire doit primer -----------------------------
-- (la résolution applicative interroge category_memory ; on vérifie ici que la
--  mémoire renvoie bien Restaurants et non Alcool, avec le bon ordre de force)
do $$
declare v_slug text;
begin
  select c.slug into v_slug
    from public.category_memory m
    join public.categories c on c.id = m.category_id
   where m.user_id = '33333333-3333-3333-3333-333333333333'
     and m.key_value = 'biere bar x'
     and m.amount_bucket in (public.amount_bucket(-19.90), 'any')
   order by (m.amount_bucket <> 'any') desc, m.hits desc
   limit 1;
  assert v_slug = 'restaurant',
    format('le mois suivant retomberait sur "%s" au lieu de restaurant', v_slug);
end $$;

-- Une correction concurrente affaiblit l'ancienne mémoire ---------------------
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, category_confidence, fingerprint)
select '33333333-3333-3333-3333-333333333333',
       'aaaaaaaa-0000-0000-0000-000000000001',
       date '2026-02-12', -19.90, 'CB BIERE BAR X 12/02', 'biere bar x', 'biere bar x',
       c.id, 'memory', 0.9, 'fp-mois2'
  from public.categories c
 where c.user_id = '33333333-3333-3333-3333-333333333333' and c.slug = 'restaurant';

select public.apply_category_correction(
  (select id from public.bank_transactions where fingerprint = 'fp-mois2'),
  (select id from public.categories
    where user_id = '33333333-3333-3333-3333-333333333333' and slug = 'bar'),
  false);

do $$
declare v_resto int; v_bar int;
begin
  select coalesce(max(m.hits),0) into v_resto from public.category_memory m
    join public.categories c on c.id = m.category_id
   where m.key_value='biere bar x' and m.amount_bucket='small' and c.slug='restaurant';
  select coalesce(max(m.hits),0) into v_bar from public.category_memory m
    join public.categories c on c.id = m.category_id
   where m.key_value='biere bar x' and m.amount_bucket='small' and c.slug='bar';

  assert v_bar > v_resto,
    format('la nouvelle préférence devrait dominer (bar=%s, resto=%s)', v_bar, v_resto);
  assert v_resto = 1, format('l''ancienne mémoire aurait dû être affaiblie (=%s)', v_resto);
end $$;

-- Exception par montant (§12) : même marchand, montant très différent ---------
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, category_confidence, fingerprint)
select '33333333-3333-3333-3333-333333333333',
       'aaaaaaaa-0000-0000-0000-000000000001',
       date '2026-02-20', -480.00, 'CB AMAZON 20/02', 'amazon', 'amazon',
       c.id, 'heuristic', 0.5, 'fp-amazon-xl'
  from public.categories c
 where c.user_id='33333333-3333-3333-3333-333333333333' and c.slug='shopping';

insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, category_confidence, fingerprint)
select '33333333-3333-3333-3333-333333333333',
       'aaaaaaaa-0000-0000-0000-000000000001',
       date '2026-02-21', -12.00, 'CB AMAZON 21/02', 'amazon', 'amazon',
       c.id, 'heuristic', 0.5, 'fp-amazon-micro'
  from public.categories c
 where c.user_id='33333333-3333-3333-3333-333333333333' and c.slug='shopping';

select public.apply_category_correction(
  (select id from public.bank_transactions where fingerprint='fp-amazon-micro'),
  (select id from public.categories
    where user_id='33333333-3333-3333-3333-333333333333' and slug='alimentation'), false);

do $$
declare v_micro text; v_large text;
begin
  select c.slug into v_micro from public.category_memory m
    join public.categories c on c.id=m.category_id
   where m.key_value='amazon' and m.amount_bucket='small' order by m.hits desc limit 1;
  assert v_micro = 'alimentation',
    format('le petit montant Amazon devrait être appris en alimentation (%s)', v_micro);

  select c.slug into v_large from public.category_memory m
    join public.categories c on c.id=m.category_id
   where m.key_value='amazon' and m.amount_bucket='xl' order by m.hits desc limit 1;
  assert v_large is null,
    'le gros montant Amazon ne doit PAS hériter de la correction du petit';
end $$;

-- Ignorer une transaction : jamais de suppression (§13) -----------------------
select public.set_transaction_status(
  (select id from public.bank_transactions where fingerprint='fp-mois2'), 'ignored');

do $$
begin
  assert (select status from public.bank_transactions where fingerprint='fp-mois2') = 'ignored';
  assert (select count(*) from public.bank_transactions where fingerprint='fp-mois2') = 1,
         'la transaction ignorée doit rester en base';
  assert (select ignored_count from public.ignore_memory where key_value='biere bar x') = 1,
         'le geste d''ignorer n''a pas été mémorisé';
end $$;

-- Agrégats mensuels : transferts et ignorées exclus, null si inconnu ----------
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, category_id,
   category_source, fingerprint)
select '33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001',
       date '2026-02-01', 2500.00, 'VIR SALAIRE', 'salaire', c.id, 'rule', 'fp-salaire'
  from public.categories c
 where c.user_id='33333333-3333-3333-3333-333333333333' and c.slug='salaire';

insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, category_id,
   category_source, fingerprint)
select '33333333-3333-3333-3333-333333333333','aaaaaaaa-0000-0000-0000-000000000001',
       date '2026-02-02', -1000.00, 'VIR EPARGNE', 'epargne', c.id, 'rule', 'fp-transfert'
  from public.categories c
 where c.user_id='33333333-3333-3333-3333-333333333333' and c.slug='transfert';

do $$
declare r record;
begin
  select * into r from public.monthly_summary(date '2026-02-01');
  assert r.income = 2500.00, format('revenus=%s (le transfert doit être exclu)', r.income);
  -- dépenses de février : amazon 480 + amazon 12 = 492 (biere ignorée, transfert exclu)
  assert r.expense = 492.00, format('dépenses=%s', r.expense);
  assert r.net_savings = 2008.00, format('épargne=%s', r.net_savings);
  assert r.savings_rate = 80.32, format('taux=%s', r.savings_rate);
end $$;

do $$
declare r record;
begin
  -- Mois sans revenu connu : le taux doit être NULL, jamais 0 (§46)
  select * into r from public.monthly_summary(date '2026-01-01');
  assert r.savings_rate is null, 'un taux inconnu doit être null, pas 0';
end $$;

-- Répartition par catégorie ---------------------------------------------------
do $$
declare r record;
begin
  select * into r from public.category_breakdown(date '2026-02-01','expense') limit 1;
  assert r.slug = 'shopping', format('la plus grosse catégorie devrait être shopping (%s)', r.slug);
  assert r.total = 480.00, format('total shopping=%s', r.total);
end $$;

reset role;
rollback;

\echo '  ✓ apprentissage des catégories'
