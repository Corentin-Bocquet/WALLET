# Design

Le système visuel dérive des captures fournies : Trade Republic et OKX.
Ce document dit ce qui en a été retenu, et pourquoi.

## Ce que les références ont en commun

- **Fond noir absolu** (`#000000`), cartes à peine plus claires, **aucune
  bordure**. La hiérarchie vient du contraste de surface, pas du trait.
- **Un seul accent vif** — vert lime chez OKX, violet chez Trade Republic.
  WALLET garde les deux : le lime pour l'action et le positif, le violet pour
  les dépenses et les catégories.
- **Chiffres énormes** (jusqu'à 52 px), graisse 700, interlettrage serré
  (−0,035 em), chiffres tabulaires pour que les colonnes s'alignent.
- **Libellés gris moyen**, jamais blancs : le blanc est réservé à
  l'information, le gris au contexte.
- **Rayons généreux** : 24 px sur les cartes, boutons complètement arrondis.
- **Densité faible.** Beaucoup d'air vertical, peu d'éléments par écran.
- **Boutons flottants** en bas, au-dessus de la barre de navigation.
- **Graphiques sans axes ni grille** : une ligne fine avec halo, un
  remplissage en trame de points, deux valeurs extrêmes. Sur un téléphone, la
  forme de la courbe suffit.
- **Bulles proportionnelles** pour les répartitions — plus rapide à lire qu'un
  camembert.

## Ce qui a été ajouté

Trois éléments absents des références, imposés par le cahier des charges :

- **La puce ⓘ**, à côté de chaque notion complexe. Elle ouvre une explication à
  trois niveaux, dont **seul le premier est affiché par défaut**.
- **L'indicateur de fraîcheur**, sous chaque chiffre qui vient d'une source
  externe. Il dit l'âge réel, et vire à l'orange quand la donnée est ancienne.
- **Le badge « estimé »**, sur tout chiffre calculé plutôt que mesuré.

## Tokens

Ils sont tous dans `app/css/tokens.css`, y compris le thème clair.

```css
--bg:        #000000;   /* fond */
--surface:   #151517;   /* cartes */
--surface-2: #1F1F22;   /* boutons secondaires, avatars */
--text:      #FFFFFF;   /* information */
--text-2:    #A1A1A6;   /* contexte */
--text-3:    #6E6E73;   /* métadonnées */
--accent:    #BFF23A;   /* action, positif */
--accent-2:  #7C4DFF;   /* dépenses, catégories */
--up:        #34D96B;
--down:      #FF453A;
```

Les cinq zones d'opportunité ont leurs propres couleurs, du vert au rouge.

## Typographie

Pile système : `-apple-system` sur iPhone, ce qui donne SF Pro. Aucune police
téléchargée — c'est autant de kilo-octets et de latence en moins, et le rendu
est natif.

| Rôle | Taille |
|---|---|
| Grand montant | `clamp(2.5rem, 11vw, 3.25rem)` |
| Titre d'écran | 1,75 rem |
| Titre de section | 1,1875 rem |
| Corps | 1 rem |
| Métadonnée | 0,75 rem |

## Règles d'interface

**Un écran = une question.** Accueil : comment va mon patrimoine ? Marchés :
que font les marchés ? Portefeuille : où est mon argent ? Opportunités : où
sont les zones intéressantes ? Profil : comment configurer ?

**Trois secondes.** En arrivant sur un écran, on doit savoir où on est, ce
qu'on regarde, si c'est bon ou mauvais, et ce qu'on peut faire ensuite.

**Rien de complexe par défaut.** Accordéons, bottom sheets, « voir plus ». Le
mode avancé est un réglage du profil, pas un bouton sur chaque écran.

**Une valeur inconnue s'affiche « — », jamais « 0 € ».** C'est appliqué par
construction dans `fmt.js` : toutes les fonctions de formatage renvoient `—`
pour `null`, `undefined` ou `NaN`.

**Le mouvement sert à situer, pas à décorer.** Entrée d'écran de 240 ms,
enfoncement de 140 ms au toucher, feuilles qui glissent. Tout est neutralisé
sous `prefers-reduced-motion`.

## Son et vibration

Onze sons d'interface, décodés une fois puis rejoués via WebAudio — un
`<audio>` par clic sature sur iOS et introduit un retard audible. Le contexte
n'est créé qu'au premier geste, comme l'exige Safari.

La vibration est câblée mais **sans effet sur iPhone** : Safari n'expose pas
`navigator.vibrate`. L'interface le dit dans les réglages plutôt que d'afficher
un interrupteur qui ne fait rien.

Les deux sont désactivables.

## iPhone

- `viewport-fit=cover` et variables `env(safe-area-inset-*)` partout.
- Barre de navigation en `backdrop-filter`, comme les barres natives.
- Cibles tactiles de 44 px minimum.
- Zones de saisie à 16 px minimum : en dessous, Safari zoome à la mise au
  point.
- `overscroll-behavior: contain` pour supprimer le rebond du document.
- Écrans de lancement fournis pour cinq tailles d'iPhone. Sans eux,
  l'application installée démarre sur un écran blanc.

## Accessibilité

- Anneau de focus visible au clavier, invisible au doigt.
- Rôles et libellés ARIA sur les éléments interactifs sans texte.
- Contraste : blanc sur noir (21:1), gris `--text-2` sur noir (9,7:1).
- Thème clair complet, y compris en mode « système ».
- `prefers-reduced-motion` respecté.
