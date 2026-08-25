-- ============================================================================
-- WALLET · 0004 · Banking : transactions, catégories, apprentissage
-- ============================================================================

-- categories : arbre de catégories, par utilisateur (les défauts sont copiés
-- à l'inscription pour que tout soit renommable/supprimable — §16, §35)
create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  slug         text not null,
  label        text not null,
  emoji        text not null default '📦',
  color        text not null default '#8E8E93',
  kind         text not null default 'expense' check (kind in ('expense','income','transfer','investment')),
  parent_id    uuid references public.categories(id) on delete set null,
  budget_month numeric(14,2),
  is_system    boolean not null default false,   -- livrée par défaut (renommable, non supprimable)
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (user_id, slug)
);
create index if not exists categories_user_idx on public.categories(user_id, kind);

-- bank_transactions -----------------------------------------------------------
--   status distingue les 4 états demandés au §13 :
--     active   → compte dans toutes les analyses
--     ignored  → conservée, exclue des analyses (choix utilisateur)
--     hidden   → conservée, masquée de la liste
--     pending  → importée mais pas encore rapprochée
--   Rien n'est jamais supprimé automatiquement.
create table if not exists public.bank_transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  booked_at          date not null,
  value_at           date,
  amount             numeric(16,2) not null,          -- négatif = dépense
  currency           text not null default 'EUR',
  raw_label          text not null,                   -- libellé brut de la banque
  clean_label        text not null default '',        -- libellé normalisé (merchant)
  merchant           text,
  counterparty_iban  text,
  operation_type     text,                            -- CARTE, VIR, PRLV, CHQ…
  status             text not null default 'active'
                     check (status in ('active','ignored','hidden','pending')),
  category_id        uuid references public.categories(id) on delete set null,
  category_source    text not null default 'none'
                     check (category_source in ('none','rule','memory','heuristic','model','user','recurring')),
  category_confidence numeric(4,3) not null default 0,
  category_reason    jsonb not null default '{}'::jsonb,  -- « pourquoi cette catégorie ? » (§47)
  recurring_id       uuid,
  is_anomaly         boolean not null default false,
  anomaly_score      numeric(6,3),
  notes              text,
  tags               text[] not null default '{}',
  import_batch       uuid,
  external_id        text,
  fingerprint        text not null,                   -- dédoublonnage d'import
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, fingerprint)
);
create index if not exists tx_user_date_idx    on public.bank_transactions(user_id, booked_at desc);
create index if not exists tx_user_cat_idx     on public.bank_transactions(user_id, category_id);
create index if not exists tx_clean_label_trgm on public.bank_transactions using gin (clean_label gin_trgm_ops);
create index if not exists tx_recurring_idx    on public.bank_transactions(recurring_id) where recurring_id is not null;

-- category_rules : règles explicites créées par l'utilisateur (§16) -----------
--   priority : plus grand = plus prioritaire. Les règles utilisateur battent
--   toujours la mémoire et les heuristiques.
create table if not exists public.category_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid not null references public.categories(id) on delete cascade,
  match_type    text not null default 'contains'
                check (match_type in ('contains','equals','starts_with','regex','iban')),
  pattern       text not null,
  -- conditions optionnelles : ne s'applique qu'entre min et max, ou à un signe
  amount_min    numeric(16,2),
  amount_max    numeric(16,2),
  sign          text check (sign in ('debit','credit')),
  account_id    uuid references public.accounts(id) on delete cascade,
  priority      int not null default 100,
  is_active     boolean not null default true,
  hit_count     int not null default 0,
  last_hit_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rules_user_idx on public.category_rules(user_id, is_active, priority desc);

-- category_corrections : journal brut de chaque correction (§10, §11, §17) ----
create table if not exists public.category_corrections (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  transaction_id   uuid references public.bank_transactions(id) on delete set null,
  clean_label      text not null,
  merchant         text,
  amount           numeric(16,2),
  from_category_id uuid references public.categories(id) on delete set null,
  to_category_id   uuid not null references public.categories(id) on delete cascade,
  previous_source  text,
  created_at       timestamptz not null default now()
);
create index if not exists corrections_user_label_idx on public.category_corrections(user_id, clean_label);

-- category_memory : mémoire agrégée, c'est ELLE que lit le moteur -------------
--   Une ligne par (utilisateur, clé, seau de montant). Le seau permet de gérer
--   les exceptions du §12 : "Amazon 12 €" ≠ "Amazon 480 €".
create table if not exists public.category_memory (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_type      text not null default 'merchant' check (key_type in ('merchant','token','iban')),
  key_value     text not null,
  amount_bucket text not null default 'any',    -- 'any','micro','small','medium','large','xl'
  category_id   uuid not null references public.categories(id) on delete cascade,
  hits          int not null default 1,          -- nombre de confirmations
  corrections   int not null default 0,          -- nombre de fois où l'utilisateur a corrigé VERS cette catégorie
  last_seen_at  timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  unique (user_id, key_type, key_value, amount_bucket, category_id)
);
create index if not exists memory_lookup_idx on public.category_memory(user_id, key_type, key_value);

-- ignore_memory : apprend quels types de transactions l'utilisateur exclut (§13)
create table if not exists public.ignore_memory (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key_value     text not null,
  amount_bucket text not null default 'any',
  ignored_count int not null default 1,
  kept_count    int not null default 0,
  last_seen_at  timestamptz not null default now(),
  unique (user_id, key_value, amount_bucket)
);

-- recurring_transactions : abonnements, loyers, salaires (§19) ----------------
create table if not exists public.recurring_transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_id      uuid references public.accounts(id) on delete cascade,
  label           text not null,
  merchant        text,
  category_id     uuid references public.categories(id) on delete set null,
  kind            text not null default 'subscription'
                  check (kind in ('subscription','rent','salary','loan','insurance','transfer','other')),
  cadence         text not null default 'monthly'
                  check (cadence in ('weekly','biweekly','monthly','bimonthly','quarterly','yearly','irregular')),
  average_amount  numeric(16,2) not null,
  last_amount     numeric(16,2),
  amount_variance numeric(16,2) not null default 0,
  occurrences     int not null default 0,
  first_seen      date,
  last_seen       date,
  next_expected   date,
  confidence      numeric(4,3) not null default 0.5,
  is_active       boolean not null default true,
  is_confirmed    boolean not null default false, -- confirmé par l'utilisateur
  signature       text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, signature)
);
create index if not exists recurring_user_idx on public.recurring_transactions(user_id, is_active);

alter table public.bank_transactions
  drop constraint if exists bank_transactions_recurring_fk;
alter table public.bank_transactions
  add constraint bank_transactions_recurring_fk
  foreign key (recurring_id) references public.recurring_transactions(id) on delete set null;

-- import_batches : traçabilité des imports de relevés ------------------------
create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  account_id    uuid references public.accounts(id) on delete set null,
  filename      text,
  format        text not null default 'csv' check (format in ('csv','ofx','qif','json','manual')),
  rows_total    int not null default 0,
  rows_imported int not null default 0,
  rows_skipped  int not null default 0,
  period_start  date,
  period_end    date,
  status        text not null default 'done' check (status in ('parsing','done','error')),
  message       text,
  created_at    timestamptz not null default now()
);

drop trigger if exists touch_tx on public.bank_transactions;
create trigger touch_tx before update on public.bank_transactions
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_rules on public.category_rules;
create trigger touch_rules before update on public.category_rules
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_recurring on public.recurring_transactions;
create trigger touch_recurring before update on public.recurring_transactions
  for each row execute function public.touch_updated_at();
