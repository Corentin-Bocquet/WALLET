drop index if exists public.category_rules_user_match_pattern_key;
-- Index simple (et non sur une expression) : c'est la seule forme qu'un
-- upsert « on conflict (colonnes) » sait viser. Les motifs sont déjà
-- normalisés en minuscules avant écriture.
create unique index if not exists category_rules_user_match_pattern_key
  on public.category_rules (user_id, match_type, pattern);
