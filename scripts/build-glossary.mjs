/**
 * Génère app/js/data/glossary.js depuis la table `glossary` d'une base
 * Postgres où les migrations ont été appliquées.
 *
 * Pourquoi générer plutôt qu'écrire à la main : le glossaire existe en deux
 * endroits (la base, pour être enrichi sans redéploiement ; le bundle, pour
 * fonctionner hors ligne). Deux copies écrites à la main divergent toujours.
 * Ici, la base est la source de vérité et le fichier JS en est le reflet.
 *
 *   usage : node scripts/build-glossary.mjs [nom_de_base]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const db = process.argv[2] || process.env.PGDATABASE || 'wallet_parity';
const host = process.env.PGHOST || '/var/tmp';
const port = process.env.PGPORT || '55432';

const json = execFileSync('psql', [
  '-h', host, '-p', port, '-U', 'postgres', '-d', db, '-tAc',
  `select coalesce(jsonb_object_agg(code, to_jsonb(g) - 'updated_at'), '{}'::jsonb)
     from public.glossary g;`,
], { encoding: 'utf8' }).trim();

const entries = JSON.parse(json);
const codes = Object.keys(entries).sort();

if (!codes.length) {
  console.error('glossaire vide — les migrations ont-elles été appliquées ?');
  process.exit(1);
}

const file = `/**
 * WALLET · Glossaire embarqué — FICHIER GÉNÉRÉ, NE PAS MODIFIER À LA MAIN.
 *
 * Source de vérité : la table \`public.glossary\` (migration 0008).
 * Régénérer avec :  node scripts/build-glossary.mjs
 *
 * Cette copie sert de repli : une explication doit pouvoir s'ouvrir hors
 * connexion et en mode démonstration, sans aller-retour réseau.
 */

export const GLOSSARY_FALLBACK = ${JSON.stringify(entries, null, 2)};

export const GLOSSARY_CODES = ${JSON.stringify(codes, null, 2)};
`;

writeFileSync(new URL('../app/js/data/glossary.js', import.meta.url), file);
console.log(`glossaire régénéré : ${codes.length} entrées`);
