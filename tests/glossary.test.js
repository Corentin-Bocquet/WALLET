/**
 * Le glossaire embarqué doit rester en phase avec la table `glossary`.
 * Sinon, une explication ouverte hors connexion afficherait un texte
 * différent — ou rien — par rapport à la même explication en ligne.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLOSSARY_FALLBACK, GLOSSARY_CODES } from '../app/js/data/glossary.js';

const SQL = readFileSync(
  new URL('../supabase/migrations/20260101000800_seed_defaults.sql', import.meta.url), 'utf8');

test('tous les codes du glossaire SQL sont présents dans la copie embarquée', () => {
  // Les lignes du INSERT commencent par ('code','Terme',
  const codesInSql = [...SQL.matchAll(/^\('([a-z_]+)','/gm)].map((m) => m[1]);
  assert.ok(codesInSql.length >= 10, `seulement ${codesInSql.length} entrées trouvées dans le SQL`);

  for (const code of codesInSql) {
    assert.ok(GLOSSARY_FALLBACK[code], `entrée manquante dans la copie embarquée : ${code}`);
  }
  assert.deepEqual(GLOSSARY_CODES.slice().sort(), codesInSql.slice().sort());
});

test('chaque entrée porte bien ses trois niveaux, du plus court au plus long', () => {
  for (const [code, entry] of Object.entries(GLOSSARY_FALLBACK)) {
    assert.ok(entry.term, `${code} : terme manquant`);
    for (const level of ['level1', 'level2', 'level3']) {
      assert.ok(entry[level] && entry[level].length > 20, `${code} : ${level} vide ou trop court`);
    }
    assert.ok(entry.level1.length < entry.level2.length,
      `${code} : le niveau 1 doit être plus court que le niveau 2`);
    assert.ok(entry.level2.length < entry.level3.length,
      `${code} : le niveau 2 doit être plus court que le niveau 3`);
    assert.ok(Array.isArray(entry.sources), `${code} : sources manquantes`);
  }
});

test('le niveau 1 tient en une phrase simple', () => {
  for (const [code, entry] of Object.entries(GLOSSARY_FALLBACK)) {
    assert.ok(entry.level1.length <= 160,
      `${code} : le niveau 1 fait ${entry.level1.length} caractères, ce n'est plus « une phrase simple »`);
    const sentences = entry.level1.split(/[.!?]\s/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${code} : le niveau 1 contient ${sentences.length} phrases`);
  }
});

test('les termes affichés dans l’interface ont tous une explication', () => {
  // Ces codes sont référencés par les écrans : s'ils disparaissent du
  // glossaire, une puce ⓘ ouvrirait une feuille vide.
  const requis = ['mvrv', 'mayer', 'drawdown', 'fear_greed', 'savings_rate',
    'investment_score', 'dca', 'net_worth', 'cycle_position', 'confidence',
    'anomaly', 'alt_btc_ratio'];
  for (const code of requis) {
    assert.ok(GLOSSARY_FALLBACK[code], `explication manquante pour ${code}`);
  }
});
