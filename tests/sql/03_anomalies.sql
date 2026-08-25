-- ============================================================================
-- TEST · refresh_anomalies doit décider comme engine/anomalies.js (§20)
--   Même scénario que tests/banking.test.js : une catégorie « alimentation »
--   qui mélange boulangerie (~3 €) et courses (~50 €).
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages to warning;
begin;

insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'anomalies@example.test');

set local role authenticated;
set local "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
select public.seed_user_defaults();

insert into public.accounts (id, user_id, kind, provider, label)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        '44444444-4444-4444-4444-444444444444', 'bank', 'test', 'Courant');

-- 24 passages en boulangerie entre 3 et 4,50 €
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, fingerprint)
select '44444444-4444-4444-4444-444444444444',
       'bbbbbbbb-0000-0000-0000-000000000001',
       current_date - (i * 3), -(3 + (i % 4) * 0.5),
       'CB BOULANGERIE MARTIN', 'boulangerie martin', 'boulangerie martin',
       c.id, 'heuristic', 'fp-boul-' || i
  from generate_series(1, 24) i
  join public.categories c
    on c.user_id = '44444444-4444-4444-4444-444444444444' and c.slug = 'alimentation';

-- 12 pleins de courses entre 48 et 72 €
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, fingerprint)
select '44444444-4444-4444-4444-444444444444',
       'bbbbbbbb-0000-0000-0000-000000000001',
       current_date - (i * 7), -(48 + (i % 5) * 6),
       'CB CARREFOUR MARKET', 'carrefour market', 'carrefour market',
       c.id, 'heuristic', 'fp-carr-' || i
  from generate_series(1, 12) i
  join public.categories c
    on c.user_id = '44444444-4444-4444-4444-444444444444' and c.slug = 'alimentation';

-- Aucune anomalie attendue : chaque achat est normal POUR SON MARCHAND.
do $$
declare v_flagged int;
begin
  v_flagged := public.refresh_my_anomalies();
  assert v_flagged = 0,
    format('%s anomalies signalées alors qu''aucune ne l''est réellement', v_flagged);
  assert (select count(*) from public.bank_transactions
           where user_id = '44444444-4444-4444-4444-444444444444' and is_anomaly) = 0;
end $$;

-- Un plein à 410 € doit ressortir, comparé aux AUTRES pleins.
insert into public.bank_transactions
  (user_id, account_id, booked_at, amount, raw_label, clean_label, merchant,
   category_id, category_source, fingerprint)
select '44444444-4444-4444-4444-444444444444',
       'bbbbbbbb-0000-0000-0000-000000000001',
       current_date - 2, -410,
       'CB CARREFOUR MARKET', 'carrefour market', 'carrefour market',
       c.id, 'heuristic', 'fp-carr-gros'
  from public.categories c
 where c.user_id = '44444444-4444-4444-4444-444444444444' and c.slug = 'alimentation';

do $$
declare v_flagged int;
begin
  v_flagged := public.refresh_my_anomalies();
  assert v_flagged = 1, format('attendu 1 anomalie, obtenu %s', v_flagged);
  assert (select is_anomaly from public.bank_transactions
           where fingerprint = 'fp-carr-gros'), 'le gros plein doit être signalé';
  assert (select anomaly_score from public.bank_transactions
           where fingerprint = 'fp-carr-gros') > 3.5, 'score trop faible';
end $$;

-- Un revenu, une récurrence et une transaction ignorée sont hors du champ.
update public.bank_transactions
   set recurring_id = null, status = 'ignored'
 where fingerprint = 'fp-carr-gros';

do $$
begin
  perform public.refresh_my_anomalies();
  assert (select is_anomaly from public.bank_transactions
           where fingerprint = 'fp-carr-gros') = false,
    'une transaction ignorée ne doit plus être signalée';
end $$;

reset role;
rollback;

\echo '  ✓ détection d''anomalies côté serveur'
