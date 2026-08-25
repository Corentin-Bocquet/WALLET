-- ============================================================================
-- WALLET · 0008 · Valeurs par défaut installées à l'inscription
--   Catégories, modèle de score, scénarios BTC. Tout est modifiable ensuite.
-- ============================================================================

create or replace function public.seed_user_defaults(p_user uuid default auth.uid())
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_created int := 0; v_btc uuid;
begin
  if p_user is null or p_user <> auth.uid() then
    raise exception 'non autorisé';
  end if;

  -- 1. Catégories par défaut (§9) -------------------------------------------
  insert into public.categories (user_id, slug, label, emoji, color, kind, is_system, sort_order)
  values
    (p_user,'alimentation','Alimentation','🛒','#4CD964','expense',true,10),
    (p_user,'restaurant','Restaurants','🍔','#FF9F0A','expense',true,20),
    (p_user,'bar','Bars & cafés','🍻','#FFD60A','expense',true,30),
    (p_user,'alcool','Alcool','🍷','#BF5AF2','expense',true,40),
    (p_user,'transport','Transport','🚗','#0A84FF','expense',true,50),
    (p_user,'logement','Logement','🏠','#5E5CE6','expense',true,60),
    (p_user,'abonnements','Abonnements','🔄','#64D2FF','expense',true,70),
    (p_user,'loisirs','Loisirs','🎮','#FF375F','expense',true,80),
    (p_user,'shopping','Shopping','🛍️','#FF2D55','expense',true,90),
    (p_user,'voyage','Voyage','✈️','#30D158','expense',true,100),
    (p_user,'sante','Santé','🩺','#FF453A','expense',true,110),
    (p_user,'etudes','Études','🎓','#AC8E68','expense',true,120),
    (p_user,'sport','Sport','🏋️','#32D74B','expense',true,130),
    (p_user,'frais-bancaires','Frais bancaires','🏦','#8E8E93','expense',true,140),
    (p_user,'impots','Impôts & taxes','🧾','#98989D','expense',true,150),
    (p_user,'cadeaux','Cadeaux & dons','🎁','#FF6482','expense',true,160),
    (p_user,'autres','Autres','📦','#8E8E93','expense',true,900),
    (p_user,'salaire','Salaire','💼','#30D158','income',true,200),
    (p_user,'revenus','Autres revenus','💶','#4CD964','income',true,210),
    (p_user,'remboursement','Remboursements','↩️','#64D2FF','income',true,220),
    (p_user,'dividendes','Dividendes & intérêts','📈','#BFF23A','income',true,230),
    (p_user,'investissement','Investissement','📊','#BFF23A','investment',true,300),
    (p_user,'transfert','Transfert interne','🔁','#636366','transfer',true,400)
  on conflict (user_id, slug) do nothing;
  get diagnostics v_created = row_count;

  -- 2. Modèle de score par défaut (§27) --------------------------------------
  insert into public.score_models (user_id, name, is_default)
  select p_user, 'Modèle équilibré', true
  where not exists (select 1 from public.score_models where user_id = p_user);

  -- 3. Scénarios Bitcoin par défaut (§29) ------------------------------------
  select id into v_btc from public.assets
   where kind='crypto' and symbol='BTC' order by rank nulls last limit 1;

  if v_btc is not null and not exists (
      select 1 from public.scenarios where user_id = p_user and asset_id = v_btc) then
    insert into public.scenarios (user_id, asset_id, name, kind, horizon_month, probability, assumptions)
    values
      (p_user, v_btc, 'Bear',  'bear', 12, 0.25, '{"note":"Récession, liquidité en repli","multiple_of_200w_ma":1.0}'),
      (p_user, v_btc, 'Base',  'base', 12, 0.50, '{"note":"Cycle historique moyen","multiple_of_200w_ma":2.4}'),
      (p_user, v_btc, 'Bull',  'bull', 12, 0.25, '{"note":"Adoption + liquidité forte","multiple_of_200w_ma":4.0}');
  end if;

  -- 4. Règles de catégorisation de démarrage (§16) ---------------------------
  --    Volontairement peu nombreuses : le moteur apprend le reste tout seul.
  insert into public.category_rules (user_id, category_id, match_type, pattern, priority, sign)
  select p_user, c.id, 'contains', r.pattern, 200, r.sign
    from (values
      ('carrefour','alimentation','debit'), ('leclerc','alimentation','debit'),
      ('lidl','alimentation','debit'),      ('auchan','alimentation','debit'),
      ('intermarche','alimentation','debit'),('monoprix','alimentation','debit'),
      ('netflix','abonnements','debit'),    ('spotify','abonnements','debit'),
      ('canal','abonnements','debit'),      ('free mobile','abonnements','debit'),
      ('orange','abonnements','debit'),     ('sfr','abonnements','debit'),
      ('uber','transport','debit'),         ('sncf','transport','debit'),
      ('ratp','transport','debit'),         ('total energies','transport','debit'),
      ('decathlon','sport','debit'),        ('basic fit','sport','debit'),
      ('pharmacie','sante','debit'),        ('doctolib','sante','debit'),
      ('loyer','logement','debit'),         ('edf','logement','debit'),
      ('engie','logement','debit'),         ('veolia','logement','debit'),
      ('salaire','salaire','credit'),       ('paie','salaire','credit'),
      ('impot','impots','debit'),           ('dgfip','impots','debit')
    ) as r(pattern, slug, sign)
    join public.categories c on c.user_id = p_user and c.slug = r.slug
   on conflict do nothing;

  return jsonb_build_object('ok', true, 'categories_created', v_created);
end;
$$;
grant execute on function public.seed_user_defaults(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Glossaire : explications à 3 niveaux (§6, §7)
-- ---------------------------------------------------------------------------
insert into public.glossary (code, term, level1, level2, level3, formula, sources) values
('mvrv','MVRV',
 'Compare le prix actuel du Bitcoin au prix moyen auquel il a été acheté.',
 'Le MVRV divise la valeur de marché par la « valeur réalisée », c''est-à-dire le prix moyen d''acquisition de toutes les pièces en circulation. Au-dessus de 3, les détenteurs sont en gros bénéfice — historiquement une zone de surchauffe. En dessous de 1, la moyenne des détenteurs est en perte — historiquement une zone de creux.',
 'MVRV = Market Value / Realized Value. La Realized Value valorise chaque UTXO au prix du dernier mouvement on-chain, ce qui approxime le coût de base agrégé du réseau. Le ratio est cyclique mais son amplitude décroît d''un cycle à l''autre : les seuils absolus de 2017 ne se transposent pas mécaniquement. Le z-score du MVRV (MVRV-Z) normalise cette dérive. WALLET utilise un proxy calculé à partir de l''historique de prix quand aucune source on-chain gratuite n''est disponible — le badge « estimé » vous l''indique.',
 'MVRV = Market Cap / Realized Cap',
 '["Coinmetrics (méthodologie)", "Proxy interne WALLET"]'),

('mayer','Multiple de Mayer',
 'Dit si le prix est loin au-dessus ou en dessous de sa moyenne longue.',
 'C''est simplement le prix actuel divisé par la moyenne des 200 derniers jours. Autour de 1, le prix est « dans sa moyenne ». Au-dessus de 2,4, le marché a historiquement été très chaud. En dessous de 0,8, très froid.',
 'Mayer Multiple = P / SMA200. Introduit par Trace Mayer. Sa distribution historique sur BTC place la médiane autour de 1,4 et le 95e percentile autour de 2,4. Comme toute mesure de retour à la moyenne, il se dégrade en régime de tendance forte et ne dit rien du timing : un Mayer > 2,4 peut le rester des mois.',
 'Mayer = Prix / Moyenne mobile 200 jours',
 '["Calculé localement à partir de price_history"]'),

('drawdown','Drawdown',
 'De combien le prix est descendu depuis son plus haut.',
 'Le drawdown mesure l''écart entre le prix actuel et le plus haut historique (ATH). Un drawdown de -70 % veut dire que le prix a perdu 70 % depuis son sommet. Sur Bitcoin, les grands creux de cycle se sont historiquement situés entre -75 % et -85 %.',
 'Drawdown_t = P_t / max(P_0..t) − 1. Le maximum drawdown (MDD) sur une fenêtre est le minimum de cette série. Attention au biais de survivance quand on compare des actifs : un actif qui n''a jamais retrouvé son ATH affiche un drawdown large mais peu informatif sur son risque futur.',
 'Drawdown = (Prix / ATH) − 1',
 '["Calculé localement"]'),

('fear_greed','Fear & Greed',
 'Un thermomètre de l''humeur du marché, de 0 (peur) à 100 (euphorie).',
 'L''indice agrège volatilité, volume, réseaux sociaux et dominance du Bitcoin en un chiffre. Une peur extrême a souvent coïncidé avec des creux, une avidité extrême avec des sommets — mais ce n''est ni une règle ni un signal de timing.',
 'Index composite publié par alternative.me : volatilité (25 %), momentum/volume (25 %), réseaux sociaux (15 %), enquêtes (15 %, suspendu), dominance BTC (10 %), tendances de recherche (10 %). Indicateur de sentiment, donc contrariant par nature et fortement autocorrélé au prix : il ne contient pratiquement aucune information non déjà présente dans le rendement récent.',
 null,
 '["alternative.me/crypto/fear-and-greed-index (API gratuite)"]'),

('savings_rate','Taux d''épargne',
 'La part de ce que vous gagnez que vous n''avez pas dépensée.',
 'On prend vos revenus du mois, on retire vos dépenses du mois, et on regarde ce qu''il reste en pourcentage. 2 500 € de revenus et 1 600 € de dépenses donnent 900 € d''épargne, soit 36 %. Les virements entre vos propres comptes sont exclus : se virer de l''argent n''est ni un revenu ni une dépense.',
 'Taux = (Revenus − Dépenses) / Revenus. WALLET exclut les catégories de type « transfert » et les transactions marquées ignorées. Le taux est volontairement null (et non 0) quand les revenus du mois sont inconnus ou nuls : afficher 0 % laisserait croire à une mesure alors qu''il n''y a pas de mesure.',
 'Taux d''épargne = (Revenus − Dépenses) / Revenus × 100',
 '["Calculé sur vos transactions"]'),

('investment_score','Investment Score',
 'Une note sur 100 qui résume si la période semble intéressante pour investir.',
 'Le score combine plusieurs familles d''indicateurs (position dans le cycle, valorisation, momentum, drawdown, sentiment…) selon des poids que vous choisissez. Plus le score est haut, plus les conditions ressemblent à des périodes historiquement favorables. Ce n''est pas une prédiction : c''est un résumé de l''état actuel.',
 'Chaque facteur est normalisé sur [0,100] par une fonction monotone bornée, puis agrégé par moyenne pondérée avec les poids du modèle actif. La confiance retournée est la part du poids total effectivement couverte par des données fraîches : un facteur sans donnée n''est pas remplacé par une valeur neutre, il est retiré du dénominateur, et le score le signale. Aucun facteur n''utilise de donnée postérieure à la date évaluée, ce qui rend le score rejouable en backtest sans fuite d''information.',
 'Score = Σ(poids_i × facteur_i) / Σ(poids_i)',
 '["Moteur WALLET · paramètres modifiables dans Profil → Avancé"]'),

('dca','DCA',
 'Investir la même somme à intervalle régulier, sans se soucier du prix.',
 'Le Dollar Cost Averaging consiste par exemple à acheter 100 € chaque semaine. On achète mécaniquement plus de quantité quand le prix est bas, moins quand il est haut. Cela lisse le prix de revient et supprime la question du « bon moment ».',
 'Le DCA réduit la variance du prix d''entrée mais pas nécessairement le risque terminal ; sur un actif à dérive positive, l''investissement forfaitaire immédiat domine le DCA en espérance dans environ deux cas sur trois historiquement. Son intérêt réel est comportemental (réduction du regret et de l''abandon) et de trésorerie, pas d''espérance de rendement.',
 null,
 '["Backtest WALLET, sans données futures"]'),

('net_worth','Patrimoine',
 'Tout ce que vous possédez, additionné.',
 'WALLET additionne vos comptes bancaires, vos liquidités, vos cryptos et vos actions, convertis dans votre devise. Quand une source n''a pas pu être synchronisée, le total est marqué comme partiel plutôt que faussement précis.',
 'Somme des positions valorisées au dernier prix connu, converti au taux de change du jour (BCE via Frankfurter). Les positions dont le prix est périmé au-delà du seuil de fraîcheur sont incluses mais signalées ; les comptes dont le solde est inconnu ne sont pas comptés comme 0 et déclenchent le drapeau is_partial.',
 null,
 '["Vos comptes · dernier prix connu"]'),

('cycle_position','Position dans le cycle',
 'Où l''on se situe entre le dernier creux et le dernier sommet.',
 'Bitcoin a historiquement alterné des phases de forte hausse et de longues baisses, souvent rythmées par le halving (tous les ~4 ans). Cette jauge situe le moment présent dans ce rythme, à partir du temps écoulé depuis le halving et de la distance au plus haut.',
 'Estimation composite : (a) temps normalisé depuis le dernier halving sur une période de 1 458 jours, (b) drawdown courant relatif à l''ATH, (c) écart au 200W MA. La régularité passée des cycles est une observation, pas une loi : quatre cycles constituent un échantillon minuscule et la structure du marché a changé (ETF, dérivés, détenteurs institutionnels). À traiter comme un repère narratif, jamais comme un calendrier.',
 null,
 '["Dates de halving publiques · calcul local"]'),

('confidence','Niveau de confiance',
 'À quel point le système est sûr de ce qu''il affiche.',
 'Une catégorisation à 98 % vient d''une règle que vous avez écrite ou d''une habitude bien établie. À 54 %, le système hésite et vous demandera de trancher — et il retiendra votre réponse.',
 'La confiance est la probabilité calibrée attachée à la source retenue : règle utilisateur = 1,0 ; mémoire = f(hits, corrections, ancienneté) bornée à 0,97 ; heuristique lexicale = force du match ∈ [0,4 ; 0,8] ; aucune correspondance = 0. Sous le seuil configurable (0,6 par défaut), la transaction est mise en file « à classer » plutôt que classée à tort.',
 null,
 '["Moteur de catégorisation WALLET"]'),

('anomaly','Dépense inhabituelle',
 'Une dépense beaucoup plus grosse que d''habitude dans cette catégorie.',
 'WALLET compare chaque dépense à vos propres habitudes des derniers mois dans la même catégorie. Si un restaurant à 180 € apparaît alors que votre moyenne est de 35 €, il est signalé — pas parce que c''est mal, juste pour que vous le voyiez.',
 'Score robuste basé sur la médiane et l''écart absolu médian (MAD) sur une fenêtre glissante de 6 mois, par catégorie : score = 0,6745 × (x − médiane) / MAD. Seuil par défaut à 3,5. La MAD est préférée à l''écart-type parce qu''elle ne se laisse pas gonfler par les valeurs extrêmes que l''on cherche justement à détecter. Minimum 8 observations, sinon aucune détection n''est tentée.',
 'score = 0.6745 × (x − médiane) / MAD',
 '["Calculé sur vos transactions"]'),

('alt_btc_ratio','Ratio ALT/BTC',
 'Combien vaut une crypto par rapport au Bitcoin.',
 'Si le Bitcoin monte à un certain prix et qu''une crypto retrouve son ratio d''un cycle passé, on peut en déduire un prix théorique. C''est un exercice de projection, pas une prévision.',
 'Prix_ALT = Prix_BTC × ratio(ALT/BTC). Le ratio choisi (plus haut du cycle, médiane, actuel) conditionne entièrement le résultat, et l''hypothèse implicite — que la capitalisation relative se reproduit — n''a aucune raison structurelle de tenir. La dilution par émission de nouveaux jetons est ignorée par ce calcul : à ratio de prix constant, une supply en hausse de 40 % signifie une capitalisation en hausse de 40 %.',
 'Prix ALT = Prix BTC × ratio ALT/BTC',
 '["Vos ratios · Profil → Avancé"]')
on conflict (code) do update set
  term = excluded.term, level1 = excluded.level1, level2 = excluded.level2,
  level3 = excluded.level3, formula = excluded.formula, sources = excluded.sources,
  updated_at = now();
