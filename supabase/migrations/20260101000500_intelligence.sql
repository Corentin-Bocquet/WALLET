-- ============================================================================
-- WALLET · 0005 · Moteur : scores, scénarios, objectifs, alertes, assistant
-- ============================================================================

-- score_models : paramétrage du score d'investissement (§27, §35) -------------
--   weights = { cycle, valuation, momentum, onchain, sentiment, macro,
--               drawdown, volatility } ; la somme est normalisée au calcul.
create table if not exists public.score_models (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Mon modèle',
  is_default   boolean not null default true,
  weights      jsonb not null default '{
     "cycle":20,"valuation":20,"momentum":15,"onchain":10,
     "sentiment":10,"macro":5,"drawdown":15,"volatility":5}'::jsonb,
  -- seuils des zones (§28), du plus intéressant au plus cher
  zone_thresholds jsonb not null default '{
     "exceptional":80,"interesting":65,"neutral":45,"expensive":30}'::jsonb,
  params       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- investment_scores : résultat calculé, avec le détail pour l'expliquer -------
create table if not exists public.investment_scores (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete cascade,
  model_id     uuid references public.score_models(id) on delete set null,
  day          date not null default current_date,
  score        numeric(6,2) not null,
  zone         text not null,
  factors      jsonb not null default '{}'::jsonb,  -- { cycle: {value, weight, note}, … }
  inputs       jsonb not null default '{}'::jsonb,  -- valeurs brutes utilisées
  confidence   numeric(4,3) not null default 0.5,
  computed_at  timestamptz not null default now(),
  unique (user_id, asset_id, day, model_id)
);
create index if not exists scores_user_day_idx on public.investment_scores(user_id, day desc);

-- scenarios : Bear / Base / Bull / Custom (§29) -------------------------------
create table if not exists public.scenarios (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asset_id      uuid references public.assets(id) on delete cascade,
  name          text not null,
  kind          text not null default 'custom' check (kind in ('bear','base','bull','custom')),
  horizon_month int not null default 12,
  target_price  numeric(24,8),
  probability   numeric(4,3),
  assumptions   jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- alt_ratios : ALT/BTC pour la projection du §26 ------------------------------
create table if not exists public.alt_ratios (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete cascade,
  label        text not null default 'Cycle précédent',
  ratio        numeric(24,12) not null,     -- prix ALT / prix BTC
  source       text not null default 'user' check (source in ('user','historical_high','historical_median','current')),
  note         text,
  created_at   timestamptz not null default now()
);

-- goals : objectifs patrimoniaux (§32, §35) ----------------------------------
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,
  emoji         text not null default '🎯',
  kind          text not null default 'net_worth'
                check (kind in ('net_worth','savings_rate','asset_quantity','category_budget','cash_buffer')),
  target_value  numeric(24,2) not null,
  target_date   date,
  asset_id      uuid references public.assets(id) on delete set null,
  category_id   uuid references public.categories(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- alerts : règles d'alerte personnalisables (§32) -----------------------------
create table if not exists public.alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null,
  subject       text not null check (subject in
                ('price','score','zone','net_worth','category_spend','savings_rate','goal','sync','anomaly')),
  asset_id      uuid references public.assets(id) on delete cascade,
  category_id   uuid references public.categories(id) on delete cascade,
  operator      text not null default 'gte' check (operator in ('gte','lte','crosses_up','crosses_down','changes')),
  threshold     numeric(24,8),
  threshold_text text,
  cooldown_hours int not null default 24,
  is_active     boolean not null default true,
  last_fired_at timestamptz,
  last_value    numeric(24,8),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- alert_events : historique des déclenchements -------------------------------
create table if not exists public.alert_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  alert_id    uuid references public.alerts(id) on delete cascade,
  title       text not null,
  body        text not null default '',
  severity    text not null default 'info' check (severity in ('info','success','warning','danger')),
  value       numeric(24,8),
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists alert_events_user_idx on public.alert_events(user_id, created_at desc);

-- insights : observations descriptives produites par le moteur (§31, §43) ----
create table if not exists public.insights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  code         text not null,
  scope        text not null default 'portfolio',
  title        text not null,
  body         text not null,
  severity     text not null default 'info' check (severity in ('info','success','warning','danger')),
  evidence     jsonb not null default '{}'::jsonb,   -- chiffres qui justifient l'observation
  valid_until  timestamptz,
  dismissed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists insights_user_idx on public.insights(user_id, created_at desc);

-- backtests : résultats de simulations (§30) ---------------------------------
create table if not exists public.backtests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asset_id      uuid not null references public.assets(id) on delete cascade,
  strategy      text not null check (strategy in ('dca','lump_sum','score_based','custom')),
  params        jsonb not null default '{}'::jsonb,
  period_start  date not null,
  period_end    date not null,
  invested      numeric(24,2) not null,
  final_value   numeric(24,2) not null,
  roi_pct       numeric(12,4) not null,
  max_drawdown  numeric(12,4),
  trades        int not null default 0,
  series        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- assistant_messages : historique du "Demande à ton patrimoine" (§33) --------
create table if not exists public.assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  intent      text,
  engine      text not null default 'local' check (engine in ('local','llm')),
  evidence    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists assistant_user_idx on public.assistant_messages(user_id, created_at desc);

-- glossary : les explications à 3 niveaux (§6, §7), partagées + surchargeables
create table if not exists public.glossary (
  code        text primary key,
  term        text not null,
  level1      text not null,
  level2      text not null,
  level3      text not null,
  formula     text,
  sources     jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['score_models','scenarios','goals','alerts'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s;', t);
    execute format('create trigger touch_%1$s before update on public.%1$s
                    for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;
