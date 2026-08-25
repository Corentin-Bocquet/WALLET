-- ============================================================================
-- WALLET · 0002 · Données de marché (référentiel public, partagé, lecture seule)
--   Ces tables ne contiennent AUCUNE donnée personnelle : elles sont lisibles
--   par tout utilisateur authentifié et écrites uniquement par les Edge
--   Functions (service_role). Cela évite de refaire N appels API par personne
--   et respecte les quotas gratuits (§50).
-- ============================================================================

-- assets : référentiel des actifs (crypto, actions, cash, autres) --------------
create table if not exists public.assets (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('crypto','stock','etf','cash','other')),
  symbol           text not null,                 -- BTC, AAPL, EUR
  name             text not null,
  external_id      text,                          -- id CoinGecko / ticker Yahoo
  source           text not null default 'coingecko',
  image_url        text,
  rank             int,
  is_stablecoin    boolean not null default false,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (kind, symbol, source)
);
create index if not exists assets_rank_idx   on public.assets(rank) where rank is not null;
create index if not exists assets_symbol_trgm on public.assets using gin (symbol gin_trgm_ops);
create index if not exists assets_extid_idx  on public.assets(source, external_id);

-- asset_quotes : dernier instantané connu par actif (upsert) -------------------
create table if not exists public.asset_quotes (
  asset_id             uuid primary key references public.assets(id) on delete cascade,
  currency             text not null default 'EUR',
  price                numeric(24,8),
  market_cap           numeric(28,2),
  volume_24h           numeric(28,2),
  circulating_supply   numeric(28,4),
  total_supply         numeric(28,4),
  max_supply           numeric(28,4),
  ath                  numeric(24,8),
  ath_date             date,
  atl                  numeric(24,8),
  atl_date             date,
  change_1h            numeric(12,4),
  change_24h           numeric(12,4),
  change_7d            numeric(12,4),
  change_30d           numeric(12,4),
  change_1y            numeric(12,4),
  fetched_at           timestamptz not null default now(),
  stale_after          timestamptz not null default now() + interval '10 minutes'
);

-- price_history : séries quotidiennes (close) ---------------------------------
create table if not exists public.price_history (
  asset_id   uuid not null references public.assets(id) on delete cascade,
  currency   text not null default 'EUR',
  day        date not null,
  close      numeric(24,8) not null,
  volume     numeric(28,2),
  market_cap numeric(28,2),
  primary key (asset_id, currency, day)
);
create index if not exists price_history_day_idx on public.price_history(day desc);

-- market_indicators : indicateurs globaux (Fear&Greed, dominance, etc.) -------
--   value_kind documente ce qu'on regarde ; "confidence" et "source" servent
--   au panneau de transparence (§47).
create table if not exists public.market_indicators (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,                 -- 'fear_greed', 'btc_dominance', 'mayer_multiple'…
  asset_id     uuid references public.assets(id) on delete cascade,
  day          date not null default current_date,
  value        numeric(24,8),
  value_text   text,
  source       text not null,
  is_derived   boolean not null default false, -- calculé localement plutôt que fourni par une API
  confidence   numeric(4,3),
  payload      jsonb not null default '{}'::jsonb,
  fetched_at   timestamptz not null default now(),
  unique (code, asset_id, day)
);
create index if not exists market_indicators_code_day_idx on public.market_indicators(code, day desc);

-- fx_rates : conversion de devises (source gratuite : Frankfurter/ECB) ---------
create table if not exists public.fx_rates (
  base       text not null,
  quote      text not null,
  day        date not null,
  rate       numeric(20,10) not null,
  source     text not null default 'ecb',
  primary key (base, quote, day)
);

-- sync_state : traçabilité de fraîcheur, pour n'afficher que du vrai (§45/§46)
create table if not exists public.sync_state (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade,  -- null = global
  scope          text not null,                 -- 'market','kraken','okx','bank','indicators'
  status         text not null default 'idle' check (status in ('idle','running','ok','error','rate_limited')),
  last_success   timestamptz,
  last_attempt   timestamptz,
  next_allowed   timestamptz,
  message        text,
  items          int,
  payload        jsonb not null default '{}'::jsonb,
  unique nulls not distinct (user_id, scope)
);

drop trigger if exists touch_assets on public.assets;
create trigger touch_assets before update on public.assets
  for each row execute function public.touch_updated_at();
