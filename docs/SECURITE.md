# Sécurité

## Le principe

Trois cercles, du plus exposé au plus protégé :

| Où | Ce qui s'y trouve | Qui peut le lire |
|---|---|---|
| Navigateur | l'URL du projet, la clé `anon` | tout le monde — c'est prévu |
| Base PostgreSQL | vos données, vos clés **chiffrées** | vous seul, via la RLS |
| Secrets Supabase | la clé de chiffrement, le secret de planification | les Edge Functions seules |

**Aucun secret n'est jamais placé dans le frontend.**

---

## Pourquoi la clé « anon » peut être publique

C'est le point qui surprend le plus, alors il vaut la peine d'être clair.

La clé `anon` identifie le projet, pas l'utilisateur. Seule, elle ne donne
accès à **rien** : chaque table porte une politique de Row Level Security qui
compare `user_id` à `auth.uid()`, c'est-à-dire à l'identité prouvée par le
jeton de session. Sans session valide, toute requête renvoie zéro ligne.

Ce n'est pas une affirmation théorique : `tests/sql/01_rls_isolation.sql` crée
deux utilisateurs, écrit des données pour l'un, et vérifie que l'autre ne voit
rien — y compris en tentant d'écrire une ligne au nom du premier, ce que
PostgreSQL rejette. Le test tourne à chaque exécution de `verify-schema.sh` et
dans la CI.

La clé **`service_role`**, elle, contourne la RLS. Elle ne doit exister que
dans les secrets Supabase, jamais dans ce dépôt ni dans le navigateur.

---

## Row Level Security

Les 26 tables personnelles (25 liées à `user_id`, plus `profiles` liée à `id`) ont RLS activée **et forcée** (`FORCE ROW LEVEL
SECURITY`, qui soumet même le propriétaire de la table aux politiques), avec
quatre politiques chacune :

```sql
create policy "accounts_select" on public.accounts
  for select to authenticated using (user_id = (select auth.uid()));
```

Les tables de référentiel de marché — `assets`, `asset_quotes`,
`price_history`, `market_indicators`, `fx_rates`, `glossary` — sont en lecture
seule pour tout utilisateur connecté et ne contiennent **aucune donnée
personnelle**. C'est délibéré : un référentiel partagé permet à un seul appel
d'API d'alimenter tout le monde, ce qui est le principal levier pour tenir
dans les quotas gratuits.

Les privilèges sont déclarés explicitement (migration 0009) plutôt que laissés
aux droits par défaut de Supabase : la RLS décide *quelles lignes*, les grants
décident *quelles opérations*.

---

## Vos clés Kraken et OKX

### Le trajet, une seule fois

```
Navigateur ──HTTPS──▶ Edge Function credentials-store
                          │
                          ├─▶ teste la clé auprès de l'exchange
                          ├─▶ VÉRIFIE qu'elle est en lecture seule
                          ├─▶ chiffre en AES-256-GCM
                          └─▶ écrit le chiffré en base
```

La clé ne redescend **jamais**. Aucun endpoint de WALLET ne renvoie un secret
déchiffré, et la politique RLS sur `provider_credentials` interdit toute
lecture directe depuis le client :

```sql
create policy "provider_credentials_select_safe" on public.provider_credentials
  for select to authenticated
  using (user_id = (select auth.uid()) and false);   -- aucune lecture
```

L'application n'accède qu'à la fonction `list_provider_credentials()`, qui
renvoie le fournisseur, les 4 derniers caractères de la clé publique, la date
du dernier usage et l'éventuelle erreur — jamais le secret.

### Le chiffrement

- **AES-256-GCM**, chiffrement authentifié : une modification du chiffré est
  détectée au déchiffrement.
- Clé dérivée par **HKDF-SHA256** à partir de `CREDENTIALS_KEY`, avec
  l'identifiant de l'utilisateur comme `info`. Deux comptes ayant la même clé
  API produisent donc des chiffrés différents.
- **IV aléatoire de 96 bits** par enregistrement.
- `key_version` en base prépare la rotation sans migration bloquante.

Conséquence directe : une fuite de la base seule ne permet pas de déchiffrer
quoi que ce soit. Il faudrait aussi obtenir `CREDENTIALS_KEY`, qui ne vit que
dans les secrets Supabase.

### La lecture seule, vérifiée et non promise

Le cahier des charges est catégorique : aucune possibilité de trader,
acheter, vendre, retirer ou transférer. WALLET l'applique à trois niveaux.

**1. Les endpoints autorisés sont une liste close.**

```ts
// supabase/functions/_shared/kraken.ts
const ALLOWED = new Set(['Balance', 'TradeBalance', 'TradesHistory', 'Ledgers']);
```

Tout autre endpoint est rejeté **avant la signature**. La garantie se vérifie
en lisant le fichier : ajouter `AddOrder` à cette liste serait le seul moyen
de passer un ordre.

**2. Les permissions sont contrôlées à l'enregistrement.**

- **OKX** expose les droits de la clé via `/account/config` → champ `perm`.
  Une clé portant `trade` ou `withdraw` est refusée.
- **Kraken** ne les expose pas. WALLET envoie donc un ordre en mode
  `validate=true` — un mode « à blanc » qui ne place **rien**, documenté par
  Kraken — et n'accepte la clé **que si Kraken la refuse** pour cause de
  permission insuffisante. Une clé capable de trader ne passe pas.

**3. Aucune fonction n'écrit vers un exchange.** Toutes les Edge Functions de
synchronisation lisent des soldes et des historiques, puis écrivent dans votre
base. Aucune ne fait de requête `POST` vers un endpoint d'ordre.

---

## Authentification

- Sessions Supabase Auth, jetons rafraîchis automatiquement, rotation des
  refresh tokens activée.
- Mot de passe (8 caractères minimum) ou lien magique.
- Changement d'e-mail avec double confirmation (les deux adresses reçoivent un
  message).
- Le stockage de session utilise une clé dédiée (`wallet.auth`), pour ne pas
  entrer en conflit avec une autre application du même domaine.

## Storage

Deux buckets **privés** — `avatars` et `imports` — avec une politique qui
n'autorise l'accès qu'au dossier portant votre identifiant :

```sql
using (bucket_id = 'avatars'
       and (storage.foldername(name))[1] = (select auth.uid())::text)
```

Les avatars sont servis par URL signée à durée limitée, jamais par URL
publique.

---

## Le service worker et vos données

Le service worker met en cache **la coquille de l'application** — HTML, CSS,
JavaScript, icônes — pour qu'elle s'ouvre instantanément et fonctionne hors
connexion.

Il ne met **jamais** en cache les réponses de Supabase :

```js
if (isDataRequest(url)) return;   // /rest/v1/, /auth/v1/, /functions/v1/, /storage/v1/
```

Deux raisons : afficher un solde périmé sans le dire violerait la règle de
fraîcheur, et conserver des données financières personnelles dans le cache du
navigateur est un risque inutile.

---

## CORS

`ALLOWED_ORIGIN` restreint l'origine autorisée à appeler les Edge Functions.
La valeur par défaut `*` convient au développement ; en production, mettez
l'URL exacte de votre application.

---

## Ce qui reste sous votre responsabilité

- **Le mot de passe de la base** : conservez-le, Supabase ne le réaffiche pas.
- **`CREDENTIALS_KEY`** : sa perte rend les clés d'exchange illisibles. Sans
  gravité — il suffit de les reconnecter — mais autant le savoir.
- **Créer les clés d'exchange en lecture seule.** WALLET vérifie et refuse le
  contraire, mais la bonne pratique reste de ne jamais créer une clé plus
  puissante que nécessaire.
- **Le dépôt public.** Le code peut l'être sans risque. Vos données sont dans
  votre base, vos secrets dans Supabase. Ne committez jamais un fichier `.env`.
