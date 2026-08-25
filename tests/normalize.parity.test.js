/**
 * Parité JS ↔ SQL de la normalisation des libellés.
 *
 * Enjeu réel : la mémoire de catégorisation est indexée par libellé normalisé.
 * Si `normalizeLabel()` (navigateur) et `public.normalize_label()` (Postgres)
 * divergent d'un seul espace, une correction enregistrée côté base ne sera
 * jamais retrouvée côté client. Ce test compare les deux sur des libellés
 * bancaires réels. Il est ignoré si aucun Postgres n'est joignable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { normalizeLabel, amountBucket, fingerprint } from '../app/js/engine/normalize.js';

const LABELS = [
  'CB CARREFOUR MARKET 4521 12/03/26',
  'VIR SEPA Salaire Février',
  'PRLV SEPA NETFLIX.COM 1234567890',
  'CARTE 12/03 UBER   EATS PARIS',
  'ACHAT CB AMAZON.FR*MK12P 09/02/2026',
  'VIREMENT INST M DUPONT JEAN',
  'RETRAIT DAB 15/01 BNP PARIS 8E',
  'PAIEMENT CB LA CAVE À BIÈRE-X',
  'FRAIS TENUE DE COMPTE',
  'ECHEANCE PRET IMMO REF 0098123',
  '',
  '   ',
  'ÉLECTRICITÉ ENGIE 02/2026',
];

function sqlNormalize(labels) {
  const rows = labels.map((l) => `(${quote(l)})`).join(',');
  const sql = `select coalesce(public.normalize_label(v), '') from (values ${rows}) t(v);`;
  return execFileSync('psql', [
    '-h', process.env.PGHOST || '/var/tmp',
    '-p', process.env.PGPORT || '55432',
    '-U', 'postgres', '-d', process.env.PGDATABASE || 'wallet_parity',
    '-tAc', sql,
  ], { encoding: 'utf8' }).trimEnd().split('\n');
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

let pgAvailable = true;
try {
  execFileSync('psql', ['-h', process.env.PGHOST || '/var/tmp',
    '-p', process.env.PGPORT || '55432', '-U', 'postgres',
    '-d', process.env.PGDATABASE || 'wallet_parity', '-tAc', 'select 1'],
    { stdio: 'pipe' });
} catch {
  pgAvailable = false;
}

test('normalizeLabel donne le même résultat en JS et en SQL',
  { skip: pgAvailable ? false : 'Postgres indisponible' }, () => {
    const fromSql = sqlNormalize(LABELS);
    LABELS.forEach((label, i) => {
      assert.equal(normalizeLabel(label), fromSql[i],
        `divergence sur ${JSON.stringify(label)}`);
    });
  });

test('amountBucket suit les mêmes seuils que la fonction SQL', () => {
  assert.equal(amountBucket(-9.99), 'micro');
  assert.equal(amountBucket(-10), 'small');
  assert.equal(amountBucket(29.99), 'small');
  assert.equal(amountBucket(-30), 'medium');
  assert.equal(amountBucket(-99.99), 'medium');
  assert.equal(amountBucket(100), 'large');
  assert.equal(amountBucket(-399.99), 'large');
  assert.equal(amountBucket(-400), 'xl');
  assert.equal(amountBucket(0), 'micro');
  assert.equal(amountBucket(null), 'micro');
});

test("l'empreinte dédoublonne deux imports qui se chevauchent", () => {
  const a = { account_id: 'acc-1', booked_at: '2026-03-12', amount: -18.4, raw_label: 'CB BIERE BAR X 12/03' };
  const b = { account_id: 'acc-1', booked_at: '2026-03-12T00:00:00Z', amount: -18.40, raw_label: 'CB  BIERE  BAR  X 12/03' };
  assert.equal(fingerprint(a), fingerprint(b));

  const c = { ...a, amount: -18.41 };
  assert.notEqual(fingerprint(a), fingerprint(c));
});
