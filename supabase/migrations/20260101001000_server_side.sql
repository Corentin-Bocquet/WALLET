-- ============================================================================
-- WALLET · 0010 · Fonctions appelées par les Edge Functions
--   Elles agissent pour le compte d'un utilisateur DÉSIGNÉ, sans auth.uid(),
--   parce que le planificateur les exécute pour tout le monde. Elles sont donc
--   réservées au rôle service_role : aucun droit d'exécution n'est accordé à
--   `authenticated`, qui dispose déjà des versions liées à auth.uid().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- monthly_summary_for : même calcul que monthly_summary, utilisateur explicite
-- ---------------------------------------------------------------------------
create or replace function public.monthly_summary_for(
  p_user  uuid,
  p_month date default date_trunc('month', current_date)::date
)
returns table (
  month date, income numeric, expense numeric, invested numeric,
  net_savings numeric, savings_rate numeric, tx_count int
)
language sql stable security definer set search_path = public as $$
  with base as (
    select t.amount, coalesce(c.kind, 'expense') as cat_kind
      from public.bank_transactions t
      left join public.categories c on c.id = t.category_id
     where t.user_id = p_user
       and t.status = 'active'
       and t.booked_at >= date_trunc('month', p_month)::date
       and t.booked_at <  (date_trunc('month', p_month) + interval '1 month')::date
       and coalesce(c.kind, 'expense') <> 'transfer'
  ), agg as (
    select
      coalesce(sum(amount) filter (where amount > 0 and cat_kind <> 'investment'), 0) as income,
      coalesce(-sum(amount) filter (where amount < 0 and cat_kind <> 'investment'), 0) as expense,
      coalesce(-sum(amount) filter (where amount < 0 and cat_kind =  'investment'), 0) as invested,
      count(*)::int as n
    from base
  )
  select
    date_trunc('month', p_month)::date, agg.income, agg.expense, agg.invested,
    agg.income - agg.expense,
    case when agg.income > 0
         then round(((agg.income - agg.expense) / agg.income) * 100, 2)
         else null end,
    agg.n
  from agg;
$$;
revoke all on function public.monthly_summary_for(uuid, date) from public, anon, authenticated;
grant execute on function public.monthly_summary_for(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- refresh_anomalies : détection côté serveur (§20)
--
--   Reprend exactement la logique de engine/anomalies.js :
--     1. comparaison au MARCHAND d'abord, si ≥ 8 passages ;
--     2. repli sur la catégorie, avec un seuil 1,4× plus strict, parce qu'une
--        catégorie mélange souvent plusieurs habitudes de tailles différentes ;
--     3. médiane et MAD plutôt que moyenne et écart-type, pour ne pas se
--        laisser gonfler par les valeurs extrêmes qu'on cherche à détecter ;
--     4. filtre de pertinence : au moins 1,8× la médiane ET 15 € d'écart.
--
--   Sans cette fonction, l'alerte « dépense inhabituelle » ne pourrait pas
--   fonctionner application fermée : la détection ne vivrait que dans le
--   navigateur.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_anomalies(
  p_user        uuid,
  p_window_days int default 183,
  p_threshold   numeric default 3.5,
  p_min_samples int default 8
)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with eligible as (
    select t.id, t.category_id, abs(t.amount) as amount,
           coalesce(nullif(t.merchant, ''), t.clean_label) as merchant_key
      from public.bank_transactions t
     where t.user_id = p_user
       and t.status = 'active'
       and t.amount < 0
       and t.recurring_id is null
       and t.booked_at >= current_date - p_window_days
  ),
  -- Statistiques par marchand
  merchant_stats as (
    select merchant_key,
           count(*) as n,
           percentile_cont(0.5) within group (order by amount) as med
      from eligible
     where merchant_key is not null and merchant_key <> ''
     group by merchant_key
  ),
  merchant_mad as (
    select e.merchant_key, m.n, m.med,
           percentile_cont(0.5) within group (order by abs(e.amount - m.med)) as mad
      from eligible e
      join merchant_stats m on m.merchant_key = e.merchant_key
     group by e.merchant_key, m.n, m.med
  ),
  -- Statistiques par catégorie
  category_stats as (
    select category_id,
           count(*) as n,
           percentile_cont(0.5) within group (order by amount) as med
      from eligible
     group by category_id
  ),
  category_mad as (
    select e.category_id, c.n, c.med,
           percentile_cont(0.5) within group (order by abs(e.amount - c.med)) as mad
      from eligible e
      join category_stats c on c.category_id is not distinct from e.category_id
     group by e.category_id, c.n, c.med
  ),
  scored as (
    select e.id, e.amount,
           -- Le marchand prime dès qu'il a assez d'historique.
           case when mm.n >= p_min_samples then mm.med else cm.med end          as med,
           case when mm.n >= p_min_samples then mm.mad else cm.mad end          as mad,
           case when mm.n >= p_min_samples then mm.n   else cm.n   end          as n,
           case when mm.n >= p_min_samples then p_threshold
                else p_threshold * 1.4 end                                       as threshold
      from eligible e
      left join merchant_mad mm on mm.merchant_key = e.merchant_key
      left join category_mad cm on cm.category_id is not distinct from e.category_id
  ),
  flagged as (
    select id, amount, med::numeric as med,
           -- percentile_cont rend un double : on repasse en numeric pour
           -- garder une arithmétique exacte et pouvoir arrondir.
           case when mad > 0
                then ((amount - med::numeric) / (mad::numeric / 0.6745))
                else null end as score
      from scored
     where n >= p_min_samples and med is not null and mad is not null and mad > 0
  ),
  final as (
    select id, round(score, 3) as score
      from flagged f
      join scored s using (id)
     where f.score >= s.threshold
       and f.amount >= f.med * 1.8
       and f.amount - f.med >= 15
  ),
  cleared as (
    update public.bank_transactions
       set is_anomaly = false, anomaly_score = null
     where user_id = p_user
       and is_anomaly = true
       and id not in (select id from final)
    returning 1
  ),
  marked as (
    update public.bank_transactions t
       set is_anomaly = true, anomaly_score = f.score
      from final f
     where t.id = f.id and t.user_id = p_user
    returning 1
  )
  select count(*) into v_count from marked;

  return coalesce(v_count, 0);
end;
$$;
revoke all on function public.refresh_anomalies(uuid, int, numeric, int) from public, anon;
grant execute on function public.refresh_anomalies(uuid, int, numeric, int) to service_role;

-- Version pour l'utilisateur connecté, appelable depuis l'application.
--   SECURITY DEFINER parce que `authenticated` n'a délibérément pas le droit
--   d'exécuter refresh_anomalies(uuid) : il pourrait sinon passer l'identifiant
--   d'un autre compte. Ici l'identifiant est imposé par auth.uid(), donc le
--   caller ne peut agir que sur ses propres données.
create or replace function public.refresh_my_anomalies()
returns int
language sql security definer set search_path = public as $$
  select public.refresh_anomalies(auth.uid());
$$;
grant execute on function public.refresh_my_anomalies() to authenticated;
