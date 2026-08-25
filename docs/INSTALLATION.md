# Installation

De zéro à WALLET sur votre écran d'accueil. Comptez 20 à 30 minutes.

> **Ce que je peux faire et ce que je ne peux pas.**
> Tout le code, les migrations, les fonctions et la configuration sont déjà
> écrits. En revanche, je ne peux pas créer de compte à votre place, ni
> générer vos clés API : cela demande votre e-mail, votre mot de passe et vos
> autorisations. Les étapes ci-dessous sont exactement celles qui restent, et
> il n'y en a pas d'autres.

---

## Étape 0 — Essayer sans rien installer

```bash
git clone https://github.com/Corentin-Bocquet/WALLET.git
cd WALLET
python3 -m http.server 8099 --directory app
```

Ouvrez `http://localhost:8099` et choisissez **« Essayer en mode
démonstration »**. Vous avez l'application complète avec des données simulées.

Corrigez la catégorie d'une transaction, rechargez la page : la correction est
toujours là, et elle s'applique aux transactions similaires. C'est exactement
le comportement que vous aurez avec vos vraies données.

---

## Étape 1 — Créer le projet Supabase

1. Allez sur [supabase.com](https://supabase.com) → **Start your project**.
   Connexion par GitHub, **aucune carte bancaire demandée**.
2. **New project** :
   - Name : `wallet`
   - Database password : générez-en un et **conservez-le**
   - Region : `Central EU (Frankfurt)` — le plus proche de la France
   - Plan : **Free**
3. Attendez 2 minutes que le projet se provisionne.

Notez, dans **Settings → API** :
- **Project URL** — `https://xxxxxxxx.supabase.co`
- **anon public** — la clé qui commence par `eyJ…`

> La clé `anon` est **publique par conception**. Elle ne donne accès à rien
> sans authentification : c'est la Row Level Security qui protège les données.
> La clé **`service_role`**, elle, contourne toutes les sécurités : ne la
> mettez jamais dans le navigateur, ni dans ce dépôt.

---

## Étape 2 — Appliquer les migrations

### Avec la CLI Supabase (recommandé)

```bash
npm install -g supabase
supabase login
supabase link --project-ref VOTRE_REF   # la partie xxxxxxxx de l'URL
supabase db push
```

### Sans rien installer

Ouvrez **SQL Editor** dans le tableau de bord Supabase et exécutez les
fichiers de `supabase/migrations/` **dans l'ordre alphabétique**, un par un :

```
20260101000100_core_identity.sql
20260101000200_market_data.sql
20260101000300_accounts_portfolio.sql
20260101000400_banking.sql
20260101000500_intelligence.sql
20260101000600_rls.sql
20260101000700_functions.sql
20260101000800_seed_defaults.sql
20260101000900_grants.sql
20260101001000_server_side.sql
```

Chacun est idempotent : le rejouer ne casse rien.

**Vérification** : dans **Table Editor**, vous devez voir 23 tables, et chacune
doit afficher le cadenas **RLS enabled**.

---

## Étape 3 — Connecter l'application

Deux façons, au choix.

**Depuis l'application** (le plus simple, marche depuis l'iPhone) :
ouvrez WALLET → **Connecter mon serveur Supabase** → collez l'URL et la clé
`anon`.

**Dans le code** : éditez `app/config.local.js` et décommentez le bloc.

Créez ensuite votre compte depuis l'écran de connexion. Les catégories par
défaut, le modèle de score et les scénarios Bitcoin sont installés
automatiquement à l'inscription.

> Si vous ne recevez pas l'e-mail de confirmation : **Authentication →
> Providers → Email**, désactivez **Confirm email** le temps de la mise en
> route. Le service d'envoi gratuit de Supabase est limité à quelques messages
> par heure.

---

## Étape 4 — Déployer les Edge Functions

Nécessaire uniquement pour Kraken, OKX, la synchronisation automatique du
marché et les alertes. L'import de relevés fonctionne sans.

```bash
# 1. Les secrets, qui ne quittent jamais le serveur
openssl rand -base64 48        # → CREDENTIALS_KEY
openssl rand -hex 32           # → CRON_SECRET

supabase secrets set CREDENTIALS_KEY="…"
supabase secrets set CRON_SECRET="…"
supabase secrets set ALLOWED_ORIGIN="https://votrenom.github.io"

# 2. Les fonctions
supabase functions deploy credentials-store
supabase functions deploy kraken-sync
supabase functions deploy okx-sync
supabase functions deploy market-sync   --no-verify-jwt
supabase functions deploy portfolio-snapshot --no-verify-jwt
supabase functions deploy alerts-run    --no-verify-jwt

# 3. Premier remplissage du marché
curl -X POST "https://VOTRE_REF.supabase.co/functions/v1/market-sync?force=1"
```

> `CREDENTIALS_KEY` chiffre vos clés d'exchange. Si vous la perdez, les clés
> enregistrées deviennent illisibles et il faudra les reconnecter — sans
> aucune conséquence sur vos comptes.

---

## Étape 5 — Connecter Kraken et OKX (lecture seule)

### Kraken

**Settings → API → Add key**. Cochez **uniquement** :
- ✅ Query Funds
- ✅ Query Ledger Entries
- ✅ Query Open/Closed Orders & Trades

Ne cochez **aucune** permission commençant par *Create*, *Modify*, *Cancel* ou
*Withdraw*.

### OKX

**Profil → API → Créer une clé V5**. Permissions : **Read** uniquement.
Notez la passphrase, elle est demandée par WALLET.

### Dans WALLET

**Profil → Comptes et connexions → Kraken** (ou OKX), collez les valeurs.

WALLET **vérifie les permissions avant d'enregistrer** :
- OKX expose ses droits, ils sont lus directement ;
- Kraken ne les expose pas, alors WALLET envoie un ordre en mode
  `validate=true` — qui ne place **rien** — et n'accepte la clé que si Kraken
  la refuse. Une clé capable de trader est rejetée avec un message explicite.

---

## Étape 6 — Vos relevés bancaires

1. **Profil → Comptes → + Ajouter** : créez votre compte courant.
   Laissez le solde vide si vous ne le connaissez pas — WALLET affichera « — »
   et signalera un total partiel, plutôt que de compter 0 €.
2. Exportez depuis votre banque. Boursorama : *Compte → Opérations →
   Exporter → CSV*.
3. **Profil → Comptes → Importer un relevé**.

Les transactions sont catégorisées automatiquement. Celles dont WALLET n'est
pas sûr apparaissent dans **« À classer »**. Chaque correction est retenue.

---

## Étape 7 — Publier sur GitHub Pages

**Settings → Pages → Source : GitHub Actions**. Poussez sur `main` : le
workflow `deploy.yml` publie le contenu de `app/`.

Pour que l'application arrive déjà configurée, ajoutez dans
**Settings → Secrets and variables → Actions → Variables** :
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Puis, dans Supabase, **Authentication → URL Configuration**, ajoutez votre URL
GitHub Pages aux **Redirect URLs**.

---

## Étape 8 — Installer sur l'iPhone

1. Ouvrez l'URL dans **Safari** (Chrome iOS ne sait pas installer de PWA).
2. **Partager** → **Sur l'écran d'accueil**.
3. Ouvrez WALLET depuis l'icône : plein écran, sans barre d'adresse.

---

## Étape 9 — Automatiser

Dans **Settings → Secrets and variables → Actions → Secrets** :
- `SUPABASE_FUNCTIONS_URL` = `https://VOTRE_REF.supabase.co/functions/v1`
- `CRON_SECRET` = celui de l'étape 4

Le workflow `schedule.yml` rafraîchit alors le marché toutes les 2 heures, et
enregistre l'instantané du patrimoine + évalue les alertes chaque soir.

Cette planification a un second rôle : elle garde le projet Supabase actif.
Un projet gratuit sans aucune activité pendant 7 jours est mis en pause.

---

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| « Serveur injoignable » | URL mal recopiée, ou projet Supabase en pause |
| Aucun prix affiché | `market-sync` jamais appelé — lancez-le avec `?force=1` |
| « Cette clé dispose de droits de trading » | La clé n'est pas en lecture seule, recréez-la |
| Pas d'e-mail de confirmation | Quota d'envoi Supabase atteint, ou *Confirm email* à désactiver |
| Une catégorie revient toujours fausse | Créez une règle : elle bat tout le reste |
| Total marqué « partiel » | Un compte a un solde inconnu — c'est volontaire, renseignez-le |
