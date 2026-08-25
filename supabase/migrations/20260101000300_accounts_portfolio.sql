-- ============================================================================
-- WALLET · 0003 · Comptes, avoirs, portefeuille
--   Aucune clé API n'est stockée ici en clair : voir provider_credentials,
--   chiffrée AES-GCM par une clé qui ne vit que dans les secrets Supabase.
-- ============================================================================

-- accounts : un compte = une source de valeur (exchange, banque, cash, autre)
create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('exchange','bank','broker','cash','manual')),
  provider       text not null,                -- 'kraken','okx','boursorama','manual'
  label          text not null,
  currency       text not null default 'EUR',
  iban_last4     text,
  is_active      boolean not null default true,
  include_in_net_worth boolean not null default true,
  -- balance connue ; null = INCONNU (jamais affiché comme 0 €, cf. §46)
  balance        numeric(24,8),
  balance_at     timestamptz,
  sort_order     int not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists accounts_user_idx on public.accounts(user_id, kind);

-- provider_credentials : secrets chiffrés côté serveur -------------------------
--   ciphertext = AES-GCM(base64) produit et lu UNIQUEMENT par les Edge
--   Functions. Le frontend peut lister les lignes (label, scope, statut) mais
--   la policy RLS lui interdit de lire la colonne chiffrée : voir la vue
--   public.provider_credentials_safe.
create table if not exists public.provider_credentials (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  provider       text not null check (provider in ('kraken','okx','custom')),
  label          text not null default '',
  ciphertext     text not null,
  iv             text not null,
  key_version    int  not null default 1,
  scope          text not null default 'read_only' check (scope = 'read_only'),
  fingerprint    text,                        -- 4 derniers caractères de la clé publique
  last_used_at   timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  unique (user_id, provider, label)
);

create or replace view public.provider_credentials_safe
with (security_invoker = true) as
  select id, user_id, provider, label, scope, fingerprint, last_used_at, last_error, created_at
  from public.provider_credentials;

-- holdings : quantité détenue d'un actif sur un compte ------------------------
create table if not exists public.holdings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete restrict,
  quantity     numeric(28,10) not null default 0,
  avg_cost     numeric(24,8),                 -- prix de revient moyen, devise du compte
  cost_currency text not null default 'EUR',
  source       text not null default 'manual' check (source in ('manual','sync','import')),
  synced_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, asset_id)
);
create index if not exists holdings_user_idx on public.holdings(user_id);

-- portfolio_snapshots : valeur du patrimoine dans le temps --------------------
create table if not exists public.portfolio_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  captured_at    timestamptz not null default now(),
  day            date not null default current_date,
  currency       text not null default 'EUR',
  total_value    numeric(24,2) not null,
  crypto_value   numeric(24,2) not null default 0,
  equity_value   numeric(24,2) not null default 0,
  cash_value     numeric(24,2) not null default 0,
  other_value    numeric(24,2) not null default 0,
  breakdown      jsonb not null default '{}'::jsonb,
  is_partial     boolean not null default false, -- une source manquait à ce moment
  unique (user_id, day)
);
create index if not exists snapshots_user_day_idx on public.portfolio_snapshots(user_id, day desc);

-- asset_watchlist : favoris (§35) ---------------------------------------------
create table if not exists public.asset_watchlist (
  user_id     uuid not null references auth.users(id) on delete cascade,
  asset_id    uuid not null references public.assets(id) on delete cascade,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, asset_id)
);

-- investment_transactions : achats/ventes d'actifs (backtest & comportement) ---
create table if not exists public.investment_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid references public.accounts(id) on delete set null,
  asset_id     uuid not null references public.assets(id) on delete restrict,
  side         text not null check (side in ('buy','sell','deposit','withdraw','reward','fee')),
  quantity     numeric(28,10) not null,
  price        numeric(24,8),
  currency     text not null default 'EUR',
  fee          numeric(24,8) not null default 0,
  executed_at  timestamptz not null,
  external_id  text,
  source       text not null default 'manual',
  note         text,
  created_at   timestamptz not null default now(),
  unique nulls not distinct (user_id, source, external_id)
);
create index if not exists inv_tx_user_time_idx on public.investment_transactions(user_id, executed_at desc);

drop trigger if exists touch_accounts on public.accounts;
create trigger touch_accounts before update on public.accounts
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_holdings on public.holdings;
create trigger touch_holdings before update on public.holdings
  for each row execute function public.touch_updated_at();
