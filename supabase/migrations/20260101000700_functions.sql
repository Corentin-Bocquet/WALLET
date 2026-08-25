-- ============================================================================
-- WALLET · 0007 · Fonctions applicatives (RPC)
--   Tout ce qui est plus rapide/plus sûr côté base : agrégats mensuels,
--   apprentissage des catégories, normalisation des libellés.
-- ============================================================================

-- Repli sans l'extension unaccent (non garantie sur tous les projets free)
create or replace function public.unaccent_fallback(txt text)
returns text language sql immutable as $$
  select translate(coalesce(txt,''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY');
$$;

-- ---------------------------------------------------------------------------
-- normalize_label : "CB CARREFOUR MARKET 1234 12/03" → "carrefour market"
--   Retire dates, numéros de carte, préfixes d'opération, accents, ponctuation.
--   Utilisée à l'import ET par le moteur de catégorisation : les deux côtés
--   doivent produire exactement la même clé.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_label(raw text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(coalesce(unaccent_fallback(raw), '')),
          '\y(cb|carte|paiement|prlv|prelevement|vir|virement|sepa|inst|achat|retrait|facture|ref|mandat|echeance)\y',
          ' ', 'g'),
        '[0-9]{2}[/.\-][0-9]{2}([/.\-][0-9]{2,4})?', ' ', 'g'),
      '[0-9]{4,}', ' ', 'g'),
    '[^a-z0-9 ]+', ' ', 'g')), '');
$$;

-- ---------------------------------------------------------------------------
-- amount_bucket : seau de montant, pour gérer les exceptions (§12)
-- ---------------------------------------------------------------------------
create or replace function public.amount_bucket(amount numeric)
returns text language sql immutable as $$
  select case
    when abs(coalesce(amount,0)) <   10 then 'micro'
    when abs(amount) <   30 then 'small'
    when abs(amount) <  100 then 'medium'
    when abs(amount) <  400 then 'large'
    else 'xl' end;
$$;

-- ---------------------------------------------------------------------------
-- apply_category_correction : LE cœur de l'apprentissage (§10, §11, §17)
--   Appelée quand l'utilisateur change une catégorie à la main.
--   1. met à jour la transaction (source = 'user', confiance = 1)
--   2. journalise la correction
--   3. renforce la mémoire pour le marchand, sur le bon seau de montant
--   4. renforce aussi une entrée 'any' plus faible, pour généraliser
--   5. optionnellement, applique la même catégorie aux transactions similaires
-- ---------------------------------------------------------------------------
create or replace function public.apply_category_correction(
  p_transaction_id uuid,
  p_category_id    uuid,
  p_apply_similar  boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tx        public.bank_transactions%rowtype;
  v_bucket    text;
  v_key       text;
  v_similar   int := 0;
begin
  select * into v_tx from public.bank_transactions
   where id = p_transaction_id and user_id = auth.uid();
  if not found then
    raise exception 'transaction introuvable';
  end if;

  if not exists (select 1 from public.categories
                  where id = p_category_id and user_id = auth.uid()) then
    raise exception 'catégorie introuvable';
  end if;

  v_key    := coalesce(nullif(v_tx.merchant,''), v_tx.clean_label);
  v_bucket := public.amount_bucket(v_tx.amount);

  -- 1. la transaction elle-même
  update public.bank_transactions
     set category_id         = p_category_id,
         category_source     = 'user',
         category_confidence = 1.0,
         category_reason     = jsonb_build_object(
            'kind','user',
            'label','Vous avez choisi cette catégorie',
            'at', now()),
         updated_at          = now()
   where id = p_transaction_id;

  -- 2. journal
  insert into public.category_corrections
    (user_id, transaction_id, clean_label, merchant, amount,
     from_category_id, to_category_id, previous_source)
  values
    (auth.uid(), p_transaction_id, v_tx.clean_label, v_tx.merchant, v_tx.amount,
     v_tx.category_id, p_category_id, v_tx.category_source);

  -- 3. mémoire ciblée (marchand + seau de montant) : forte
  insert into public.category_memory
    (user_id, key_type, key_value, amount_bucket, category_id, hits, corrections)
  values (auth.uid(), 'merchant', v_key, v_bucket, p_category_id, 3, 1)
  on conflict (user_id, key_type, key_value, amount_bucket, category_id)
  do update set hits         = public.category_memory.hits + 3,
                corrections  = public.category_memory.corrections + 1,
                last_seen_at = now();

  -- 3bis. les mémoires concurrentes sur la même clé perdent du poids
  update public.category_memory
     set hits = greatest(0, hits - 2)
   where user_id = auth.uid() and key_type = 'merchant'
     and key_value = v_key and amount_bucket = v_bucket
     and category_id <> p_category_id;

  -- 4. mémoire généralisée (tous montants) : faible
  insert into public.category_memory
    (user_id, key_type, key_value, amount_bucket, category_id, hits, corrections)
  values (auth.uid(), 'merchant', v_key, 'any', p_category_id, 1, 1)
  on conflict (user_id, key_type, key_value, amount_bucket, category_id)
  do update set hits         = public.category_memory.hits + 1,
                corrections  = public.category_memory.corrections + 1,
                last_seen_at = now();

  -- 5. propagation optionnelle aux transactions non corrigées à la main
  if p_apply_similar then
    with upd as (
      update public.bank_transactions
         set category_id         = p_category_id,
             category_source     = 'memory',
             category_confidence = 0.9,
             category_reason     = jsonb_build_object(
                'kind','memory',
                'label', format('Comme vos autres « %s »', v_key)),
             updated_at = now()
       where user_id = auth.uid()
         and id <> p_transaction_id
         and category_source <> 'user'
         and coalesce(nullif(merchant,''), clean_label) = v_key
         and public.amount_bucket(amount) = v_bucket
      returning 1)
    select count(*) into v_similar from upd;
  end if;

  return jsonb_build_object(
    'ok', true,
    'key', v_key,
    'bucket', v_bucket,
    'similar_updated', v_similar);
end;
$$;
grant execute on function public.apply_category_correction(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- set_transaction_status : ignorer / masquer, et apprendre de ce geste (§13)
--   On ne supprime JAMAIS la ligne. On note simplement la préférence.
-- ---------------------------------------------------------------------------
create or replace function public.set_transaction_status(
  p_transaction_id uuid,
  p_status         text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_tx public.bank_transactions%rowtype; v_key text; v_bucket text;
begin
  if p_status not in ('active','ignored','hidden','pending') then
    raise exception 'statut invalide: %', p_status;
  end if;

  select * into v_tx from public.bank_transactions
   where id = p_transaction_id and user_id = auth.uid();
  if not found then raise exception 'transaction introuvable'; end if;

  update public.bank_transactions
     set status = p_status, updated_at = now()
   where id = p_transaction_id;

  v_key    := coalesce(nullif(v_tx.merchant,''), v_tx.clean_label);
  v_bucket := public.amount_bucket(v_tx.amount);

  insert into public.ignore_memory (user_id, key_value, amount_bucket, ignored_count, kept_count)
  values (auth.uid(), v_key, v_bucket,
          case when p_status in ('ignored','hidden') then 1 else 0 end,
          case when p_status = 'active' then 1 else 0 end)
  on conflict (user_id, key_value, amount_bucket)
  do update set
     ignored_count = public.ignore_memory.ignored_count
                     + case when p_status in ('ignored','hidden') then 1 else 0 end,
     kept_count    = public.ignore_memory.kept_count
                     + case when p_status = 'active' then 1 else 0 end,
     last_seen_at  = now();

  return jsonb_build_object('ok', true, 'status', p_status, 'key', v_key);
end;
$$;
grant execute on function public.set_transaction_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- monthly_summary : revenus / dépenses / épargne d'un mois (§21, §22)
--   Les transactions 'ignored' et 'hidden' sont exclues, les transferts aussi
--   (un virement entre mes comptes n'est ni un revenu ni une dépense).
-- ---------------------------------------------------------------------------
create or replace function public.monthly_summary(p_month date default date_trunc('month', current_date)::date)
returns table (
  month          date,
  income         numeric,
  expense        numeric,
  net_savings    numeric,
  savings_rate   numeric,
  tx_count       int
)
language sql stable security invoker set search_path = public as $$
  with base as (
    select t.amount, c.kind as cat_kind
      from public.bank_transactions t
      left join public.categories c on c.id = t.category_id
     where t.user_id = auth.uid()
       and t.status = 'active'
       and t.booked_at >= date_trunc('month', p_month)::date
       and t.booked_at <  (date_trunc('month', p_month) + interval '1 month')::date
       and coalesce(c.kind, 'expense') <> 'transfer'
  ), agg as (
    select
      coalesce(sum(amount) filter (where amount > 0), 0) as income,
      coalesce(-sum(amount) filter (where amount < 0), 0) as expense,
      count(*)::int as n
    from base
  )
  select
    date_trunc('month', p_month)::date,
    agg.income,
    agg.expense,
    agg.income - agg.expense,
    case when agg.income > 0
         then round(((agg.income - agg.expense) / agg.income) * 100, 2)
         else null end,          -- null = inconnu, pas 0 (§46)
    agg.n
  from agg;
$$;
grant execute on function public.monthly_summary(date) to authenticated;

-- ---------------------------------------------------------------------------
-- category_breakdown : répartition par catégorie d'un mois (§18)
-- ---------------------------------------------------------------------------
create or replace function public.category_breakdown(
  p_month date default date_trunc('month', current_date)::date,
  p_kind  text default 'expense'
)
returns table (
  category_id uuid, slug text, label text, emoji text, color text,
  total numeric, tx_count int, share numeric
)
language sql stable security invoker set search_path = public as $$
  with base as (
    select coalesce(c.id, '00000000-0000-0000-0000-000000000000'::uuid) as cid,
           coalesce(c.slug,'uncategorized')  as slug,
           coalesce(c.label,'Non classé')    as label,
           coalesce(c.emoji,'❓')             as emoji,
           coalesce(c.color,'#8E8E93')       as color,
           abs(t.amount) as amt
      from public.bank_transactions t
      left join public.categories c on c.id = t.category_id
     where t.user_id = auth.uid()
       and t.status = 'active'
       and t.booked_at >= date_trunc('month', p_month)::date
       and t.booked_at <  (date_trunc('month', p_month) + interval '1 month')::date
       and coalesce(c.kind,'expense') <> 'transfer'
       and case when p_kind = 'expense' then t.amount < 0 else t.amount > 0 end
  ), agg as (
    select cid, slug, label, emoji, color, sum(amt) as total, count(*)::int as n
      from base group by 1,2,3,4,5
  )
  select agg.cid, agg.slug, agg.label, agg.emoji, agg.color, agg.total, agg.n,
         round(100 * agg.total / nullif(sum(agg.total) over (), 0), 2)
    from agg
   order by agg.total desc;
$$;
grant execute on function public.category_breakdown(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- net_worth_series : historique du patrimoine (§23)
-- ---------------------------------------------------------------------------
create or replace function public.net_worth_series(p_days int default 365)
returns table (day date, total numeric, crypto numeric, equity numeric,
               cash numeric, other numeric, is_partial boolean)
language sql stable security invoker set search_path = public as $$
  select s.day, s.total_value, s.crypto_value, s.equity_value,
         s.cash_value, s.other_value, s.is_partial
    from public.portfolio_snapshots s
   where s.user_id = auth.uid()
     and s.day >= (current_date - make_interval(days => greatest(p_days,1)))::date
   order by s.day;
$$;
grant execute on function public.net_worth_series(int) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_snapshot : tout ce dont l'accueil a besoin, en 1 aller-retour
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_snapshot()
returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'net_worth', (
      select to_jsonb(x) from (
        select total_value, crypto_value, equity_value, cash_value, other_value,
               captured_at, is_partial
          from public.portfolio_snapshots
         where user_id = auth.uid()
         order by day desc limit 1) x),
    'net_worth_prev', (
      select total_value from public.portfolio_snapshots
       where user_id = auth.uid() and day <= (current_date - 30)
       order by day desc limit 1),
    'month', (select to_jsonb(m) from public.monthly_summary() m),
    'month_prev', (select to_jsonb(m) from
        public.monthly_summary((date_trunc('month', current_date) - interval '1 month')::date) m),
    'accounts_count', (select count(*) from public.accounts
                        where user_id = auth.uid() and is_active),
    'unread_alerts', (select count(*) from public.alert_events
                       where user_id = auth.uid() and read_at is null),
    'insights', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at desc), '[]'::jsonb)
                   from (select * from public.insights
                          where user_id = auth.uid() and dismissed_at is null
                            and (valid_until is null or valid_until > now())
                          order by created_at desc limit 5) i),
    'sync', (select coalesce(jsonb_object_agg(scope, jsonb_build_object(
                'status', status, 'last_success', last_success, 'message', message)), '{}'::jsonb)
               from public.sync_state
              where user_id = auth.uid() or user_id is null)
  );
$$;
grant execute on function public.dashboard_snapshot() to authenticated;
