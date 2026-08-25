# Le moteur

Comment WALLET calcule ce qu'il affiche. Chaque section correspond à un module
de `app/js/engine/`, testé dans `tests/`.

Principe qui traverse tout le fichier : **un chiffre affiché doit être
explicable, et une estimation ne doit jamais ressembler à une mesure.**

---

## Catégorisation — `categorizer.js`

Six niveaux, du plus fort au plus faible. Le premier qui répond gagne, et il
expose toujours sa raison — c'est ce qui permet à l'écran de répondre à
« pourquoi cette catégorie ? ».

| Niveau | Source | Confiance | D'où ça vient |
|---|---|---|---|
| 1 | Règle utilisateur | 1,00 | vous l'avez écrite |
| 2 | Mémoire ciblée | 0,70 → 0,97 | vos corrections, au bon ordre de grandeur |
| 3 | Mémoire générale | 0,62 → 0,88 | vos corrections, tous montants |
| 4 | Récurrence connue | 0,85 | abonnement déjà identifié |
| 5 | Dictionnaire local | 0,40 → 0,80 | 307 termes, 21 catégories |
| 6 | rien | 0,00 | mis en file « à classer » |

### Comment WALLET apprend

Quand vous corrigez une catégorie, `apply_category_correction()` fait cinq
choses :

1. applique votre choix (source `user`, confiance 1,0) ;
2. journalise la correction dans `category_corrections` ;
3. renforce la mémoire pour ce marchand **à cet ordre de grandeur** (+3) ;
4. **affaiblit les mémoires concurrentes** sur la même clé (−2) ;
5. renforce plus faiblement une mémoire « tous montants » (+1).

Le point 4 est ce qui permet de changer d'avis : sans lui, une ancienne
préférence resterait à égalité avec la nouvelle indéfiniment.

### Les ordres de grandeur, ou comment gérer Amazon

Le cahier des charges pose le problème : Amazon peut être du shopping, de
l'alimentation, de l'électronique ou des livres. Répondre « Amazon = Shopping »
serait faux la moitié du temps.

La mémoire est donc indexée par `(marchand, seau de montant)` :

| Seau | Montant |
|---|---|
| `micro` | moins de 10 € |
| `small` | 10 à 30 € |
| `medium` | 30 à 100 € |
| `large` | 100 à 400 € |
| `xl` | plus de 400 € |

Corriger « Amazon 12 € » en Alimentation n'apprend **rien** sur « Amazon
480 € ». C'est vérifié par test, côté JS et côté SQL.

Le seuil de confiance sous lequel WALLET préfère demander est réglable
(0,60 par défaut).

### Un piège de correspondance

Un terme court du dictionnaire n'est accepté **que s'il forme un mot entier**.
Sans cette garde, « bar » attrapait « BARBARA MARTIN » et « vin » attrapait
« VINCI AUTOROUTES ». Les termes d'au moins six caractères restent acceptés en
sous-chaîne, ce qui rattrape les libellés collés du type « AMAZONFR ».

### Un piège de synchronisation

La normalisation des libellés existe en deux exemplaires : `normalizeLabel()`
en JavaScript et `public.normalize_label()` en SQL. Si les deux divergent d'un
seul espace, une correction écrite en base ne serait jamais retrouvée côté
client.

`tests/normalize.parity.test.js` compare les deux sur des libellés bancaires
réels. Il a effectivement attrapé une divergence : la version SQL ne réduisait
pas les espaces multiples.

---

## Récurrences — `recurring.js`

Regroupement par marchand, puis recherche de régularité dans les intervalles.
Minimum **3 occurrences** : deux points font toujours une droite.

Cadences reconnues : hebdomadaire, bimensuelle, mensuelle, bimestrielle,
trimestrielle, annuelle — chacune avec sa tolérance.

Confiance =
`0,40 × régularité + 0,25 × stabilité des montants + 0,20 × volume + 0,15 × fraîcheur`

Avec un **garde-fou** : sous 0,35 de régularité, la série est rejetée quelle
que soit la confiance calculée. Sans lui, un marchand visité à intervalles
quelconques mais toujours pour le même montant passait pour un abonnement,
porté par la seule stabilité des montants.

Un même marchand peut porter deux séries distinctes : Amazon Prime à 6,99 €
et les commandes à 240 € sont séparées par un regroupement sur l'ordre de
grandeur.

Un abonnement dont le dernier passage remonte à plus de deux périodes est
marqué inactif — pas supprimé.

---

## Anomalies — `anomalies.js`

La bonne question n'est pas « cette dépense est-elle grosse ? » mais
**« cette dépense est-elle inhabituelle pour ce marchand ? »**.

1. Comparaison à l'historique du **marchand**, dès 8 passages.
2. À défaut seulement, comparaison à la **catégorie**, avec un seuil 1,4× plus
   strict.

Cette hiérarchie n'est pas cosmétique. Comparer un plein de courses à 90 € à
la médiane de la catégorie « alimentation » — tirée vers 10 € par les passages
quotidiens à la boulangerie — signalait une anomalie chaque semaine : 30
fausses alertes sur le jeu de démonstration, contre **une seule** avec la
comparaison par marchand, la vraie.

Méthode : **médiane et MAD**, pas moyenne et écart-type. La MAD ne se laisse
pas gonfler par les valeurs extrêmes que l'on cherche justement à détecter.

```
score = 0,6745 × (montant − médiane) / MAD
```

Trois garde-fous :
- minimum 8 observations, sinon aucune détection n'est tentée ;
- au moins 1,8× la médiane **et** 15 € d'écart — 4,20 € au lieu de 3,80 € sur
  un café n'est pas une information ;
- les récurrences sont exclues : un loyer n'est pas une surprise.

La même logique existe en SQL (`refresh_anomalies`), pour que l'alerte
fonctionne application fermée. Un test vérifie que les deux décident pareil.

---

## Indicateurs — `indicators.js`

| Indicateur | Formule | Nature |
|---|---|---|
| Multiple de Mayer | prix ÷ moyenne 200 jours | mesure exacte |
| Multiple 200 semaines | prix ÷ moyenne 200 semaines | mesure exacte |
| Drawdown | prix ÷ plus haut − 1 | mesure exacte |
| Momentum | performance 30 / 90 / 365 jours | mesure exacte |
| Volatilité | écart-type annualisé des rendements, 90 jours | mesure exacte |
| **Proxy MVRV** | prix ÷ moyenne 200 semaines | **approximation** |
| **Position de cycle** | temps depuis halving + drawdown + Mayer | **estimation** |

Les deux dernières lignes portent `is_derived: true` en base et un badge
**« estimé »** à l'écran. Le vrai MVRV exige la Realized Cap, qu'aucune API
gratuite ne fournit — le dire est plus utile que de faire semblant.

La position de cycle est un repère narratif, jamais un calendrier : quatre
cycles observés ne font pas une loi, et la structure du marché a changé
(ETF, dérivés, détenteurs institutionnels). L'explication de niveau 3 le dit.

---

## Investment Score — `score.js`

Moyenne pondérée de huit facteurs, chacun normalisé sur [0, 100] par une
fonction monotone bornée. Poids par défaut :

| Facteur | Poids | Convention |
|---|---:|---|
| Cycle | 20 | tôt dans le cycle = favorable |
| Valorisation | 20 | Mayer bas = bon marché |
| Momentum | 15 | ni trop froid ni surchauffé |
| Drawdown | 15 | chute profonde = favorable |
| On-chain | 10 | proxy MVRV bas = favorable |
| Sentiment | 10 | peur = plus favorable qu'euphorie |
| Volatilité | 5 | volatilité extrême = pénalisant |
| Macro | 5 | fourni ou absent |

Tous modifiables dans **Profil → Paramètres du moteur**. Un poids à zéro
retire le facteur du calcul.

### La règle qui compte

**Un facteur sans donnée n'est pas remplacé par une valeur neutre. Il sort du
dénominateur, et la confiance chute d'autant.**

Un score de 87 calculé sur 40 % des facteurs ne doit pas ressembler à un score
de 87 calculé sur tout. L'interface affiche la couverture, et un bandeau
« score partiel » apparaît sous 75 %.

Sans aucune donnée, le score vaut `null` — jamais 0. Un score inconnu et un
score nul ne veulent pas dire la même chose.

### Zones

| Zone | Seuil par défaut |
|---|---|
| 🟢 Exceptionnelle | ≥ 80 |
| 🟢 Intéressante | ≥ 65 |
| 🟡 Neutre | ≥ 45 |
| 🟠 Chère | ≥ 30 |
| 🔴 Distribution | < 30 |

Seuils modifiables, avec vérification qu'ils restent décroissants.

---

## Scénarios — `scenarios.js`

**Aucune fonction de ce module ne renvoie un chiffre seul.** Toute projection
sort avec sa fourchette, son hypothèse et ses limites.

### Bitcoin

`prix cible = moyenne 200 semaines × multiple`

Le multiple est un paramètre (1,0 / 2,4 / 4,0 par défaut pour Bear / Base /
Bull). L'écran affiche la fourchette en gros, le scénario central en dessous,
et l'espérance pondérée seulement si toutes les probabilités sont fournies.

### Altcoins

`prix ALT = prix BTC × ratio(ALT/BTC)`

Trois limites sont affichées **à côté du résultat**, pas en note de bas de
page :
- le résultat dépend entièrement du ratio choisi ;
- le calcul suppose que la capitalisation relative se reproduise ;
- la dilution par émission de nouveaux jetons n'est pas prise en compte.

### Portefeuille

« Que vaut mon portefeuille si BTC atteint 200 000 € ? » — les actifs sans
hypothèse de prix gardent leur valeur actuelle et sont **signalés comme tels**.
On ne fabrique pas une corrélation qu'on n'a pas mesurée.

---

## Backtest — `backtest.js`

> « Ne jamais utiliser de données futures dans une simulation historique. »

Cette contrainte est appliquée **structurellement**, pas par discipline :

- `sliceUpTo(series, i)` est le seul accès aux prix, et coupe strictement à la
  date du jour simulé ;
- la décision d'un jour est prise avec `history[0..i]`, jamais `history[i+1]` ;
- l'exécution se fait au cours du jour de décision, pas au cours du lendemain.

**Le test qui le prouve** : on lance une simulation, puis on la relance sur la
même série dont tout le futur au-delà de la fenêtre a été multiplié par 1000.
Le capital investi, le nombre de décisions, la valeur finale et **chaque
décision jour par jour** doivent être identiques.

Trois stratégies comparées : DCA régulier, tout en une fois, piloté par le
score. L'investissement en une fois engage exactement le **même capital total**
que le DCA — comparer 5 200 € étalés à 100 € en une fois n'aurait aucun sens.

Sentiment et macro sont volontairement absents du score rejoué : leur
historique n'est pas archivé, et inventer une valeur passée serait précisément
la fuite qu'on cherche à éviter.

---

## Comportement — `behaviour.js`

Descriptif, jamais prescriptif. Minimum **5 achats**, sinon le module refuse
de conclure et le dit.

Quatre observations : achats après hausse, achats après baisse, moment des
meilleurs achats (drawdown médian), régularité, concentration temporelle.

Chaque observation porte le nombre d'achats sur lequel elle repose. Trois
achats ne font pas un profil d'investisseur, et l'interface le rappelle.

---

## Assistant — `assistant.js`

Moteur **local et déterministe**. Aucune donnée envoyée à un tiers, aucune API
payante, aucune clé requise.

Onze intentions reconnues, résolues par **priorité** puis par longueur du motif
reconnu. Sans priorité, « Combien ai-je en SOL ? » tombait dans l'intention
« patrimoine total » — les deux contiennent « combien… ai ».

Certaines intentions ont une **garde** : « position sur un actif » ne se
déclenche que si un symbole connu est effectivement cité.

Chaque réponse porte les chiffres qui la justifient et un lien pour vérifier
soi-même. Une question hors sujet obtient « je ne sais pas » et la liste de ce
que l'assistant sait faire — pas une invention.

Ce n'est pas une limite subie : sur un patrimoine, une réponse fausse coûte
plus cher qu'un « je ne sais pas ».

Un point d'extension (`setLlmBridge`) permet de brancher votre propre modèle si
vous en configurez un un jour. Rien n'en dépend.
