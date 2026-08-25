/**
 * WALLET · Glossaire embarqué — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source de vérité : la table `public.glossary` (migration 0008).
 * Régénérer avec :  node scripts/build-glossary.mjs
 *
 * Cette copie sert de repli : une explication doit pouvoir s'ouvrir hors
 * connexion et en mode démonstration, sans aller-retour réseau.
 */

export const GLOSSARY_FALLBACK = {
  "dca": {
    "code": "dca",
    "term": "DCA",
    "level1": "Investir la même somme à intervalle régulier, sans se soucier du prix.",
    "level2": "Le Dollar Cost Averaging consiste par exemple à acheter 100 € chaque semaine. On achète mécaniquement plus de quantité quand le prix est bas, moins quand il est haut. Cela lisse le prix de revient et supprime la question du « bon moment ».",
    "level3": "Le DCA réduit la variance du prix d'entrée mais pas nécessairement le risque terminal ; sur un actif à dérive positive, l'investissement forfaitaire immédiat domine le DCA en espérance dans environ deux cas sur trois historiquement. Son intérêt réel est comportemental (réduction du regret et de l'abandon) et de trésorerie, pas d'espérance de rendement.",
    "formula": null,
    "sources": [
      "Backtest WALLET, sans données futures"
    ]
  },
  "mvrv": {
    "code": "mvrv",
    "term": "MVRV",
    "level1": "Compare le prix actuel du Bitcoin au prix moyen auquel il a été acheté.",
    "level2": "Le MVRV divise la valeur de marché par la « valeur réalisée », c'est-à-dire le prix moyen d'acquisition de toutes les pièces en circulation. Au-dessus de 3, les détenteurs sont en gros bénéfice — historiquement une zone de surchauffe. En dessous de 1, la moyenne des détenteurs est en perte — historiquement une zone de creux.",
    "level3": "MVRV = Market Value / Realized Value. La Realized Value valorise chaque UTXO au prix du dernier mouvement on-chain, ce qui approxime le coût de base agrégé du réseau. Le ratio est cyclique mais son amplitude décroît d'un cycle à l'autre : les seuils absolus de 2017 ne se transposent pas mécaniquement. Le z-score du MVRV (MVRV-Z) normalise cette dérive. WALLET utilise un proxy calculé à partir de l'historique de prix quand aucune source on-chain gratuite n'est disponible — le badge « estimé » vous l'indique.",
    "formula": "MVRV = Market Cap / Realized Cap",
    "sources": [
      "Coinmetrics (méthodologie)",
      "Proxy interne WALLET"
    ]
  },
  "mayer": {
    "code": "mayer",
    "term": "Multiple de Mayer",
    "level1": "Dit si le prix est loin au-dessus ou en dessous de sa moyenne longue.",
    "level2": "C'est simplement le prix actuel divisé par la moyenne des 200 derniers jours. Autour de 1, le prix est « dans sa moyenne ». Au-dessus de 2,4, le marché a historiquement été très chaud. En dessous de 0,8, très froid.",
    "level3": "Mayer Multiple = P / SMA200. Introduit par Trace Mayer. Sa distribution historique sur BTC place la médiane autour de 1,4 et le 95e percentile autour de 2,4. Comme toute mesure de retour à la moyenne, il se dégrade en régime de tendance forte et ne dit rien du timing : un Mayer > 2,4 peut le rester des mois.",
    "formula": "Mayer = Prix / Moyenne mobile 200 jours",
    "sources": [
      "Calculé localement à partir de price_history"
    ]
  },
  "anomaly": {
    "code": "anomaly",
    "term": "Dépense inhabituelle",
    "level1": "Une dépense beaucoup plus grosse que d'habitude dans cette catégorie.",
    "level2": "WALLET compare chaque dépense à vos propres habitudes des derniers mois dans la même catégorie. Si un restaurant à 180 € apparaît alors que votre moyenne est de 35 €, il est signalé — pas parce que c'est mal, juste pour que vous le voyiez.",
    "level3": "Score robuste basé sur la médiane et l'écart absolu médian (MAD) sur une fenêtre glissante de 6 mois, par catégorie : score = 0,6745 × (x − médiane) / MAD. Seuil par défaut à 3,5. La MAD est préférée à l'écart-type parce qu'elle ne se laisse pas gonfler par les valeurs extrêmes que l'on cherche justement à détecter. Minimum 8 observations, sinon aucune détection n'est tentée.",
    "formula": "score = 0.6745 × (x − médiane) / MAD",
    "sources": [
      "Calculé sur vos transactions"
    ]
  },
  "drawdown": {
    "code": "drawdown",
    "term": "Drawdown",
    "level1": "De combien le prix est descendu depuis son plus haut.",
    "level2": "Le drawdown mesure l'écart entre le prix actuel et le plus haut historique (ATH). Un drawdown de -70 % veut dire que le prix a perdu 70 % depuis son sommet. Sur Bitcoin, les grands creux de cycle se sont historiquement situés entre -75 % et -85 %.",
    "level3": "Drawdown_t = P_t / max(P_0..t) − 1. Le maximum drawdown (MDD) sur une fenêtre est le minimum de cette série. Attention au biais de survivance quand on compare des actifs : un actif qui n'a jamais retrouvé son ATH affiche un drawdown large mais peu informatif sur son risque futur.",
    "formula": "Drawdown = (Prix / ATH) − 1",
    "sources": [
      "Calculé localement"
    ]
  },
  "net_worth": {
    "code": "net_worth",
    "term": "Patrimoine",
    "level1": "Tout ce que vous possédez, additionné.",
    "level2": "WALLET additionne vos comptes bancaires, vos liquidités, vos cryptos et vos actions, convertis dans votre devise. Quand une source n'a pas pu être synchronisée, le total est marqué comme partiel plutôt que faussement précis.",
    "level3": "Somme des positions valorisées au dernier prix connu, converti au taux de change du jour (BCE via Frankfurter). Les positions dont le prix est périmé au-delà du seuil de fraîcheur sont incluses mais signalées ; les comptes dont le solde est inconnu ne sont pas comptés comme 0 et déclenchent le drapeau is_partial.",
    "formula": null,
    "sources": [
      "Vos comptes · dernier prix connu"
    ]
  },
  "confidence": {
    "code": "confidence",
    "term": "Niveau de confiance",
    "level1": "À quel point le système est sûr de ce qu'il affiche.",
    "level2": "Une catégorisation à 98 % vient d'une règle que vous avez écrite ou d'une habitude bien établie. À 54 %, le système hésite et vous demandera de trancher — et il retiendra votre réponse.",
    "level3": "La confiance est la probabilité calibrée attachée à la source retenue : règle utilisateur = 1,0 ; mémoire = f(hits, corrections, ancienneté) bornée à 0,97 ; heuristique lexicale = force du match ∈ [0,4 ; 0,8] ; aucune correspondance = 0. Sous le seuil configurable (0,6 par défaut), la transaction est mise en file « à classer » plutôt que classée à tort.",
    "formula": null,
    "sources": [
      "Moteur de catégorisation WALLET"
    ]
  },
  "fear_greed": {
    "code": "fear_greed",
    "term": "Fear & Greed",
    "level1": "Un thermomètre de l'humeur du marché, de 0 (peur) à 100 (euphorie).",
    "level2": "L'indice agrège volatilité, volume, réseaux sociaux et dominance du Bitcoin en un chiffre. Une peur extrême a souvent coïncidé avec des creux, une avidité extrême avec des sommets — mais ce n'est ni une règle ni un signal de timing.",
    "level3": "Index composite publié par alternative.me : volatilité (25 %), momentum/volume (25 %), réseaux sociaux (15 %), enquêtes (15 %, suspendu), dominance BTC (10 %), tendances de recherche (10 %). Indicateur de sentiment, donc contrariant par nature et fortement autocorrélé au prix : il ne contient pratiquement aucune information non déjà présente dans le rendement récent.",
    "formula": null,
    "sources": [
      "alternative.me/crypto/fear-and-greed-index (API gratuite)"
    ]
  },
  "savings_rate": {
    "code": "savings_rate",
    "term": "Taux d'épargne",
    "level1": "La part de ce que vous gagnez que vous n'avez pas dépensée.",
    "level2": "On prend vos revenus du mois, on retire vos dépenses du mois, et on regarde ce qu'il reste en pourcentage. 2 500 € de revenus et 1 600 € de dépenses donnent 900 € d'épargne, soit 36 %. Les virements entre vos propres comptes sont exclus : se virer de l'argent n'est ni un revenu ni une dépense.",
    "level3": "Taux = (Revenus − Dépenses) / Revenus. WALLET exclut les catégories de type « transfert » et les transactions marquées ignorées. Le taux est volontairement null (et non 0) quand les revenus du mois sont inconnus ou nuls : afficher 0 % laisserait croire à une mesure alors qu'il n'y a pas de mesure.",
    "formula": "Taux d'épargne = (Revenus − Dépenses) / Revenus × 100",
    "sources": [
      "Calculé sur vos transactions"
    ]
  },
  "alt_btc_ratio": {
    "code": "alt_btc_ratio",
    "term": "Ratio ALT/BTC",
    "level1": "Combien vaut une crypto par rapport au Bitcoin.",
    "level2": "Si le Bitcoin monte à un certain prix et qu'une crypto retrouve son ratio d'un cycle passé, on peut en déduire un prix théorique. C'est un exercice de projection, pas une prévision.",
    "level3": "Prix_ALT = Prix_BTC × ratio(ALT/BTC). Le ratio choisi (plus haut du cycle, médiane, actuel) conditionne entièrement le résultat, et l'hypothèse implicite — que la capitalisation relative se reproduit — n'a aucune raison structurelle de tenir. La dilution par émission de nouveaux jetons est ignorée par ce calcul : à ratio de prix constant, une supply en hausse de 40 % signifie une capitalisation en hausse de 40 %.",
    "formula": "Prix ALT = Prix BTC × ratio ALT/BTC",
    "sources": [
      "Vos ratios · Profil → Avancé"
    ]
  },
  "cycle_position": {
    "code": "cycle_position",
    "term": "Position dans le cycle",
    "level1": "Où l'on se situe entre le dernier creux et le dernier sommet.",
    "level2": "Bitcoin a historiquement alterné des phases de forte hausse et de longues baisses, souvent rythmées par le halving (tous les ~4 ans). Cette jauge situe le moment présent dans ce rythme, à partir du temps écoulé depuis le halving et de la distance au plus haut.",
    "level3": "Estimation composite : (a) temps normalisé depuis le dernier halving sur une période de 1 458 jours, (b) drawdown courant relatif à l'ATH, (c) écart au 200W MA. La régularité passée des cycles est une observation, pas une loi : quatre cycles constituent un échantillon minuscule et la structure du marché a changé (ETF, dérivés, détenteurs institutionnels). À traiter comme un repère narratif, jamais comme un calendrier.",
    "formula": null,
    "sources": [
      "Dates de halving publiques · calcul local"
    ]
  },
  "investment_score": {
    "code": "investment_score",
    "term": "Investment Score",
    "level1": "Une note sur 100 qui résume si la période semble intéressante pour investir.",
    "level2": "Le score combine plusieurs familles d'indicateurs (position dans le cycle, valorisation, momentum, drawdown, sentiment…) selon des poids que vous choisissez. Plus le score est haut, plus les conditions ressemblent à des périodes historiquement favorables. Ce n'est pas une prédiction : c'est un résumé de l'état actuel.",
    "level3": "Chaque facteur est normalisé sur [0,100] par une fonction monotone bornée, puis agrégé par moyenne pondérée avec les poids du modèle actif. La confiance retournée est la part du poids total effectivement couverte par des données fraîches : un facteur sans donnée n'est pas remplacé par une valeur neutre, il est retiré du dénominateur, et le score le signale. Aucun facteur n'utilise de donnée postérieure à la date évaluée, ce qui rend le score rejouable en backtest sans fuite d'information.",
    "formula": "Score = Σ(poids_i × facteur_i) / Σ(poids_i)",
    "sources": [
      "Moteur WALLET · paramètres modifiables dans Profil → Avancé"
    ]
  }
};

export const GLOSSARY_CODES = [
  "alt_btc_ratio",
  "anomaly",
  "confidence",
  "cycle_position",
  "dca",
  "drawdown",
  "fear_greed",
  "investment_score",
  "mayer",
  "mvrv",
  "net_worth",
  "savings_rate"
];
