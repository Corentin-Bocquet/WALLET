# Architecture

## Pourquoi pas de framework

Aucune dépendance de production, aucune étape de build. Le dossier `app/` est
déployable tel quel : `python3 -m http.server app` suffit, et GitHub Pages
publie directement.

Trois raisons concrètes :

1. **Poids.** Toute l'application fait moins de 200 ko sans la bibliothèque
   Supabase. Sur un iPhone en 4G, c'est la différence entre une ouverture
   instantanée et une seconde d'attente.
2. **Durabilité.** Un projet personnel qu'on rouvre dans deux ans avec zéro
   dépendance à mettre à jour reste utilisable. Avec un `package.json` de 800
   paquets, non.
3. **Aucun risque de bascule payante.** Pas de service de build, pas de
   plateforme d'hébergement avec quota, rien qui puisse devenir facturable.

La couche DOM tient en 60 lignes (`app/js/lib/dom.js`).

---

## Les couches

```
┌──────────────────────────────────────────────┐
│ screens/     un fichier par écran            │
│              assemble, ne calcule pas        │
├──────────────────────────────────────────────┤
│ components/  graphiques, explications,       │
│              briques d'interface partagées   │
├──────────────────────────────────────────────┤
│ data/repo    façade unique, cache court,     │
│              distingue vide / inconnu / erreur│
│      ├── supabaseBackend  (vos données)      │
│      └── demoStore        (démonstration)    │
├──────────────────────────────────────────────┤
│ engine/      fonctions pures, sans I/O       │
│              catégorisation, score, backtest │
├──────────────────────────────────────────────┤
│ lib/         DOM, formatage, routeur, son,   │
│              feuilles, thème                 │
└──────────────────────────────────────────────┘
```

**La règle qui structure tout** : `engine/` ne connaît ni le DOM, ni le réseau,
ni Supabase. Ce sont des fonctions pures. Conséquence : elles tournent dans le
navigateur, dans les Edge Functions Deno et dans les tests Node, avec le même
code, et elles sont testables sans monter le moindre décor.

---

## Les deux backends

`data/repo.js` expose une API unique. Derrière, deux implémentations qui
respectent exactement le même contrat :

| | `supabaseBackend` | `demoStore` |
|---|---|---|
| Données | les vôtres, via PostgREST | générées, déterministes |
| Persistance | PostgreSQL | `localStorage` |
| Catégorisation | fonction SQL | même moteur, en JS |
| Apprentissage | `apply_category_correction()` | même logique, réimplémentée |

Le mode démonstration n'est pas une maquette : il fait tourner les **vrais**
moteurs sur des données simulées. Corriger une catégorie, recharger la page, et
constater que la correction tient et s'applique aux transactions similaires —
c'est exactement le comportement de production.

C'est aussi ce qui rend le développement possible sans serveur, et ce qui
permet de tester l'assistant de bout en bout dans la CI.

---

## Le double emplacement de la catégorisation

La catégorisation existe en deux endroits, volontairement :

- **En SQL** (`apply_category_correction`), parce que la correction doit être
  atomique : mettre à jour la transaction, journaliser, renforcer une mémoire
  et en affaiblir une autre doivent réussir ou échouer ensemble.
- **En JavaScript** (`engine/categorizer.js`), parce que la *lecture* de cette
  mémoire doit être instantanée à l'affichage, sans aller-retour réseau.

Le risque évident est la divergence. Il est traité par un test :
`tests/normalize.parity.test.js` compare les deux implémentations de la
normalisation des libellés sur des libellés bancaires réels. Il a effectivement
attrapé un écart.

---

## Fraîcheur des données

Trois états, jamais confondus :

| État | Affichage |
|---|---|
| Connu et frais | la valeur, avec « mis à jour il y a X » |
| Connu mais ancien | la valeur, indicateur orange |
| Inconnu | `—`, jamais `0 €` |
| En erreur | message explicite, avec bouton réessayer |

C'est appliqué par construction : toutes les fonctions de `lib/fmt.js`
renvoient `—` pour `null`, `undefined` ou `NaN`. Il n'y a pas de chemin
possible vers un « 0 € » accidentel.

Quand une source manque, le patrimoine porte `is_partial` et l'écran affiche
un bandeau nommant les comptes concernés.

---

## Consommation des quotas

Trois décisions, par ordre d'impact :

1. **Le référentiel de marché est partagé.** `assets`, `asset_quotes`,
   `price_history` ne contiennent aucune donnée personnelle : un appel
   alimente tous les utilisateurs.
2. **`sync_state` sert de limiteur distribué.** Une Edge Function est recréée
   à chaque démarrage à froid, donc un compteur en mémoire ne tiendrait pas.
   Le créneau est réservé en base.
3. **Cache court côté client** (30 s à 15 min selon la donnée), invalidé
   sélectivement après chaque écriture.

---

## Le routeur

Routage par hash (`#/portefeuille`) plutôt qu'History API, parce que GitHub
Pages ne sait pas réécrire les URL vers `index.html`. Avec un hash, un
rechargement sur une sous-page fonctionne sans configuration serveur.

Le routeur mémorise la position de défilement par écran, comme une application
native, et annule les rendus obsolètes : si vous naviguez pendant un
chargement, l'écran abandonné ne s'affiche pas par-dessus le nouveau.

---

## Le service worker

Deux stratégies opposées, assumées :

- **Coquille de l'application** → cache d'abord, mise à jour en arrière-plan.
  Ouverture instantanée, fonctionnement hors connexion.
- **Requêtes Supabase** → réseau uniquement, jamais de cache. Afficher un solde
  périmé sans le dire violerait la règle de fraîcheur, et stocker des données
  financières dans le cache du navigateur est un risque inutile.

Une mise à jour disponible est **proposée**, pas imposée : recharger la page
au milieu d'une saisie serait hostile.

---

## Ce qui est généré plutôt qu'écrit

| Fichier | Généré par | Pourquoi |
|---|---|---|
| `app/icons/*.png` | `scripts/build-icons.mjs` | une source, dix tailles, aucun outil externe |
| `app/js/data/glossary.js` | `scripts/build-glossary.mjs` | le SQL est la source de vérité, le JS son reflet hors ligne |

Deux copies écrites à la main divergent toujours. Un test vérifie d'ailleurs
que le glossaire embarqué correspond bien au SQL.
