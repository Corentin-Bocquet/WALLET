-- Une règle est identifiée par ce qu'elle reconnaît, pas par son identifiant :
-- sans cette contrainte, réapprendre un marchand créait un doublon à chaque fois.
create unique index if not exists category_rules_user_match_pattern_key
  on public.category_rules (user_id, match_type, lower(pattern));
