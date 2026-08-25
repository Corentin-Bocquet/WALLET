# Gratuité — audit service par service

Contrainte fondamentale du projet : **tout doit être gratuit, sans carte
bancaire, sans abonnement**. Ce document liste chaque service utilisé, sa
limite réelle, et ce que WALLET fait quand cette limite est atteinte.

Il liste aussi, sans détour, **ce qui n'a pas pu être fait gratuitement**.

---

## Ce qui est utilisé

### Supabase — offre gratuite

| Ressource | Limite gratuite | Usage réel de WALLET |
|---|---|---|
| Base PostgreSQL | 500 Mo | ~15 Mo pour 5 ans de transactions et de prix |
| Authentification | 50 000 utilisateurs actifs / mois | 1 |
| Storage | 1 Go | une photo de profil, quelques ko |
| Edge Functions | 500 000 appels / mois | ~400 avec la planification livrée |
| Bande passante | 5 Go / mois | quelques Mo |

**Ce qu'il faut savoir** : un projet gratuit est **mis en pause après 7 jours
sans aucune activité**. La planification GitHub Actions livrée avec le projet
appelle `market-sync` toutes les deux heures, ce qui suffit à le garder actif.
Si vous désactivez la planification et n'ouvrez pas l'application pendant une
semaine, le projet sera suspendu — il se réveille en un clic depuis le tableau
de bord Supabase, sans perte de données.

Pas de carte bancaire requise.

### CoinGecko — API publique

- **Limite** : environ 10 à 30 appels par minute, sans clé et sans compte.
- **Usage** : 1 appel pour les 100 principales cryptos + au plus 8 appels
  d'historique, toutes les 2 heures. Soit ~110 appels par jour.
- **Quand la limite est atteinte** : la réponse 429 est détectée, la
  synchronisation s'arrête proprement, `sync_state` passe en `rate_limited`,
  et l'interface affiche « quota atteint, prochaine tentative plus tard ».
  **Aucune bascule vers l'offre payante n'est possible dans le code** : la
  fonction ne connaît aucune URL d'API payante et n'accepte aucune clé.

Trois décisions concrètes réduisent la consommation :

1. **Le référentiel de marché est partagé.** Les tables `assets`,
   `asset_quotes` et `price_history` ne contiennent aucune donnée
   personnelle : un seul appel alimente tous les utilisateurs. C'est le levier
   principal, bien plus efficace que n'importe quel réglage de cache.
2. **L'historique n'est rapatrié que pour les actifs réellement suivis**
   (détenus ou en favori), et seulement s'il date de plus de 20 heures.
3. **Un plafond dur de 8 appels d'historique par passage**, espacés de 1,5
   seconde. Le reste attend le passage suivant.

### alternative.me — Fear & Greed

- **Limite** : aucune limite documentée, pas de clé.
- **Usage** : 1 appel toutes les 2 heures.
- **Si indisponible** : le facteur « sentiment » du score est retiré du calcul
  (pas remplacé par 50), la confiance du score baisse, et l'interface l'indique.

### Frankfurter — taux de change BCE

- **Limite** : aucune, pas de clé, données de la Banque centrale européenne.
- **Usage** : 1 appel toutes les 2 heures.

### GitHub

- **Pages** : hébergement statique gratuit et illimité.
- **Actions** : 2 000 minutes par mois sur dépôt privé, illimité sur dépôt
  public. La planification livrée consomme moins de 30 minutes par mois.

### Kraken et OKX

APIs gratuites pour la consultation de compte. Aucun abonnement, aucun volume
minimum. Seules des clés **en lecture seule** sont acceptées.

---

## Ce qui n'a PAS pu être fait gratuitement

### Synchronisation bancaire automatique

C'est la seule fonctionnalité du cahier des charges qui reste hors de portée.

| Fournisseur | Offre la moins chère | Verdict |
|---|---|---|
| Powens (ex-Budget Insight) | sur devis, à partir de plusieurs centaines d'euros par mois | ⛔ |
| Bridge (Bankin' for business) | à partir de ~50 €/mois | ⛔ |
| Tink (Visa) | sur devis, orienté entreprises | ⛔ |
| GoCardless Bank Account Data (ex-Nordigen) | gratuit **mais** réservé aux entités enregistrées, avec vérification d'identité professionnelle | ⛔ pour un particulier |
| Accès DSP2 direct | gratuit en théorie | ⛔ exige un agrément d'établissement de paiement auprès de l'ACPR |

**Ce que WALLET fait à la place** : lecture des relevés exportés depuis votre
banque, en CSV, OFX ou QIF. Depuis Boursorama : *Compte → Opérations →
Exporter*. Le format français est géré correctement — `jj/mm/aaaa` n'est
jamais confondu avec `mm/jj/aaaa`, `1 234,56` avec espace insécable est lu
correctement, les colonnes débit/crédit séparées sont recombinées.

Le dédoublonnage repose sur une empreinte `(compte, date, centimes, libellé
normalisé)` : vous pouvez réimporter un relevé qui chevauche le précédent sans
créer de doublon.

**L'architecture est prête** pour un agrégateur : `accounts` porte déjà
`provider`, `import_batches` trace chaque import, et l'empreinte de
dédoublonnage fonctionnera à l'identique avec des transactions arrivant par
API. Le jour où vous choisissez un fournisseur, seule une Edge Function est à
écrire.

### Données on-chain réelles

Le MVRV, le SOPR ou les réserves d'exchange n'ont pas d'API gratuite fiable
(Glassnode, CryptoQuant et Coin Metrics sont payants, et leurs offres
gratuites n'exposent pas ces séries).

**Ce que WALLET fait à la place** : une approximation calculée localement à
partir de l'historique de prix (rapport à la moyenne 200 semaines). Cette
valeur porte le drapeau `is_derived` en base, s'affiche avec un badge
« estimé », et son explication de niveau 3 dit explicitement qu'il s'agit
d'un proxy, pas d'une mesure on-chain.

C'est le contraire de faire passer une approximation pour une donnée.

### Notifications push

Les notifications web sur iOS exigent que l'application soit installée sur
l'écran d'accueil, et restent limitées. WALLET n'en promet aucune :
`navigator.vibrate` n'existe pas dans Safari, et l'interface le dit noir sur
blanc dans les réglages plutôt que d'afficher un interrupteur sans effet.

Les alertes sont évaluées côté serveur et consultables dans l'application ;
l'envoi push viendra si une solution gratuite et fiable apparaît.

### IA générative pour la catégorisation

Toutes les APIs de modèles de langage sont payantes au-delà d'un essai.

**Ce que WALLET fait à la place** : la catégorisation repose sur vos règles,
votre historique et un dictionnaire local. Sur le jeu de démonstration, cela
classe correctement plus de 95 % des transactions dès le premier import, et le
reste s'apprend en quelques taps.

L'assistant « Demande à ton patrimoine » est lui aussi entièrement local et
déterministe. Un point d'extension existe (`setLlmBridge`) si vous souhaitez
un jour brancher votre propre modèle, mais rien n'en dépend.

---

## Règle appliquée dans le code

Un quota atteint ne mène **jamais** à une offre payante. Il mène à :

1. un cache plus long,
2. une fréquence réduite,
3. une autre source gratuite,
4. un calcul local,
5. ou, en dernier recours, l'affichage honnête de « donnée indisponible ».

C'est vérifiable : aucune fonction de ce dépôt ne contient d'URL d'API
payante, ni de champ pour une clé d'API commerciale.
