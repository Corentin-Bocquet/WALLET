# WALLET

Application web personnelle de gestion de patrimoine, crypto et finances.
PWA mobile-first, pensée pour être ajoutée à l'écran d'accueil d'un iPhone.

> **Simple en surface. Puissant en profondeur.**
> Je regarde → je comprends. Je clique → j'apprends. Je veux plus → j'analyse.

---

## Où en est le projet

L'application **fonctionne dès maintenant**, en mode démonstration, sans rien
installer :

```bash
python3 -m http.server 8099 --directory app
# puis ouvrez http://localhost:8099
```

Vous verrez 18 mois de transactions simulées, un portefeuille crypto valorisé,
la catégorisation automatique, l'apprentissage des corrections, les scénarios
Bitcoin et les backtests. Tout ce qui est simulé est signalé comme tel.

Pour brancher vos vraies données : **[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

---

## Ce qui est construit

| Domaine | État |
|---|---|
| Base Supabase (33 tables, RLS partout, 16 fonctions) | ✅ testé sur PostgreSQL réel |
| Authentification et profil | ✅ mot de passe, lien magique, avatar |
| Catégorisation qui apprend de vos corrections | ✅ 16 tests + 3 de parité JS/SQL |
| Détection des récurrences et des anomalies | ✅ 24 tests |
| Import de relevés CSV / OFX / QIF | ✅ 17 tests |
| Marchés, indicateurs, Investment Score, zones | ✅ 15 tests |
| Scénarios Bitcoin et projections ALT/BTC | ✅ |
| Backtest sans fuite de données futures | ✅ vérifié par test |
| Assistant « Demande à ton patrimoine » | ✅ 20 tests, entièrement local |
| Connecteurs Kraken et OKX, lecture seule | ✅ permissions vérifiées |
| Alertes et objectifs | ✅ évaluées côté serveur |
| PWA : manifest, service worker, icônes, splash | ✅ |
| **Synchronisation bancaire automatique** | ⛔ **impossible gratuitement** — voir ci-dessous |

**103 tests JavaScript + 3 suites SQL (isolation RLS, apprentissage, anomalies), tous verts.**

---

## La seule chose qui ne peut pas être automatisée

Aucun agrégateur bancaire français — Powens (ex-Budget Insight), Bridge,
Tink, Nordigen/GoCardless — ne propose d'offre gratuite exploitable pour un
usage personnel. Les tarifs commencent autour de 50 à 100 € par mois, et
l'accès DSP2 direct exige un agrément d'établissement de paiement.

**WALLET ne prétend donc pas synchroniser votre banque.** Il lit vos relevés
exportés (Boursorama : *Compte → Opérations → Exporter*), en CSV, OFX ou QIF,
avec dédoublonnage automatique : réimporter un relevé qui chevauche le
précédent ne crée aucun doublon.

Toute l'architecture est prête pour brancher un agrégateur le jour où vous en
choisirez un : `accounts`, `import_batches`, `bank_transactions` et les
empreintes de dédoublonnage ne changeront pas.

Le détail complet, service par service, est dans
**[docs/GRATUITE.md](docs/GRATUITE.md)**.

---

## Architecture

```
iPhone / PWA
     ↓
Frontend  ·  HTML + CSS + JavaScript, aucun framework, aucune étape de build
     ↓
Supabase Auth   ·  sessions, mots de passe, liens magiques
     ↓
Supabase Database  ·  PostgreSQL + Row Level Security
     ↓
Supabase Edge Functions  ·  seules à détenir les clés d'exchange
     ↓
APIs externes  ·  CoinGecko, alternative.me, Frankfurter (toutes gratuites)
     ↓
Financial Intelligence Engine  ·  modules purs, testés, partagés
     ↓
Interface simple
```

Les moteurs (`app/js/engine/`) sont des fonctions pures sans dépendance :
ils tournent dans le navigateur, dans les Edge Functions et dans les tests,
avec le même code.

---

## Structure

```
app/                    L'application (déployable telle quelle)
  css/                  Tokens de design, base, composants
  js/
    engine/             Moteurs purs : catégorisation, score, scénarios…
    data/               Accès aux données, backend Supabase et démonstration
    screens/            Un fichier par écran
    components/         Graphiques, explications, briques d'interface
  icons/                Icônes et écrans de lancement (générés)
  sounds/               Retours sonores d'interface

supabase/
  migrations/           10 migrations SQL, appliquées dans l'ordre
  functions/            Edge Functions Deno

tests/                  103 tests JavaScript (7 fichiers)
tests/sql/              3 suites SQL (RLS, apprentissage, anomalies)
scripts/                Vérification du schéma, génération des icônes
docs/                   Installation, gratuité, sécurité, design, moteur
```

---

## Vérifier

```bash
node --test tests/*.test.js     # moteurs, parseurs, assistant
scripts/verify-schema.sh        # migrations + RLS + apprentissage, sur PostgreSQL
node scripts/build-icons.mjs    # régénérer les icônes
node scripts/build-glossary.mjs # régénérer le glossaire embarqué depuis le SQL
```

---

## Documentation

- **[Installation](docs/INSTALLATION.md)** — de zéro à l'app sur votre iPhone
- **[Gratuité](docs/GRATUITE.md)** — chaque service, sa limite, ce qu'on fait quand elle est atteinte
- **[Sécurité](docs/SECURITE.md)** — RLS, chiffrement des clés, lecture seule
- **[Moteur](docs/MOTEUR.md)** — comment chaque score et chaque indicateur est calculé
- **[Design](docs/DESIGN.md)** — le système visuel et ses règles
