/**
 * Lecture de relevés : les pièges du CSV bancaire français.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatement, parseAmount, parseDate, splitCsvLine,
} from '../app/js/data/import.js';

/* — Montants ————————————————————————————————————————— */

test('les montants français sont lus correctement', () => {
  assert.equal(parseAmount('-12,50'), -12.5);
  assert.equal(parseAmount('1 234,56'), 1234.56);
  assert.equal(parseAmount('1 234,56'), 1234.56, 'espace insécable');
  assert.equal(parseAmount('1 234,56'), 1234.56, 'espace fine insécable');
  assert.equal(parseAmount('-1 234,56 €'), -1234.56);
  assert.equal(parseAmount('2 480,45'), 2480.45);
});

test('les montants anglo-saxons sont lus correctement', () => {
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('-1,234.56'), -1234.56);
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseAmount('1,000'), 1000);
});

test('les conventions comptables sont reconnues', () => {
  assert.equal(parseAmount('(125,40)'), -125.4, 'parenthèses = négatif');
  assert.equal(parseAmount('125,40 EUR'), 125.4);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('   '), null);
  assert.equal(parseAmount(null), null);
});

/* — Dates ————————————————————————————————————————————— */

test('jj/mm/aaaa n’est jamais confondu avec mm/jj/aaaa', () => {
  // Le piège : Date('04/03/2026') donne le 3 avril en interprétation US.
  assert.equal(parseDate('04/03/2026'), '2026-03-04', '4 mars, pas 3 avril');
  assert.equal(parseDate('31/12/2025'), '2025-12-31');
  assert.equal(parseDate('1/2/26'), '2026-02-01');
  assert.equal(parseDate('04-03-2026'), '2026-03-04');
});

test('les autres formats de date sont acceptés', () => {
  assert.equal(parseDate('2026-03-04'), '2026-03-04');
  assert.equal(parseDate('20260304'), '2026-03-04');
  assert.equal(parseDate('20260304120000'), '2026-03-04', 'horodatage OFX');
});

test('une date impossible est rejetée plutôt que corrigée', () => {
  assert.equal(parseDate('31/02/2026'), null, 'le 31 février n’existe pas');
  assert.equal(parseDate('45/13/2026'), null);
  assert.equal(parseDate('pas une date'), null);
  assert.equal(parseDate(''), null);
});

/* — Découpage CSV ————————————————————————————————— */

test('les guillemets protègent les séparateurs internes', () => {
  assert.deepEqual(
    splitCsvLine('04/03/2026;"CARREFOUR; PARIS";-54,20', ';'),
    ['04/03/2026', 'CARREFOUR; PARIS', '-54,20']);
  assert.deepEqual(
    splitCsvLine('a;"il a dit ""bonjour""";b', ';'),
    ['a', 'il a dit "bonjour"', 'b']);
});

/* — Fichiers complets ————————————————————————————— */

const CSV_BOURSORAMA = `dateOp;dateVal;label;category;amount
04/03/2026;04/03/2026;CARTE 04/03/26 CARREFOUR MARKET;Alimentation;-54,20
03/03/2026;03/03/2026;VIR SEPA SALAIRE ENTREPRISE;Revenus;2 480,45
02/03/2026;02/03/2026;PRLV SEPA NETFLIX.COM;Abonnements;-13,49`;

test('un export Boursorama est lu intégralement', () => {
  const result = parseStatement(CSV_BOURSORAMA, { filename: 'releve.csv', accountId: 'acc-1' });

  assert.equal(result.format, 'csv');
  assert.equal(result.rows.length, 3);
  assert.equal(result.warnings.length, 0);

  const [courses, salaire, netflix] = result.rows;
  assert.equal(courses.booked_at, '2026-03-04');
  assert.equal(courses.amount, -54.2);
  assert.equal(courses.operation_type, 'CARTE');
  assert.equal(courses.clean_label, 'carrefour market', 'le libellé doit être normalisé');

  assert.equal(salaire.amount, 2480.45);
  assert.equal(salaire.operation_type, 'VIR');
  assert.equal(netflix.operation_type, 'PRLV');

  assert.equal(result.periodStart, '2026-03-02');
  assert.equal(result.periodEnd, '2026-03-04');
});

test('les colonnes débit/crédit séparées sont recombinées', () => {
  const csv = `Date;Libelle;Debit;Credit
04/03/2026;CARREFOUR;54,20;
03/03/2026;SALAIRE;;2480,45`;
  const result = parseStatement(csv, { filename: 'x.csv', accountId: 'acc-1' });

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, -54.2, 'un débit doit devenir négatif');
  assert.equal(result.rows[1].amount, 2480.45);
});

test('des lignes de titre au-dessus de l’en-tête ne gênent pas', () => {
  const csv = `Releve de compte
Compte n 00012345678
Periode : du 01/03/2026 au 31/03/2026

Date;Libelle;Montant
04/03/2026;CARREFOUR;-54,20`;
  const result = parseStatement(csv, { filename: 'x.csv', accountId: 'acc-1' });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].amount, -54.2);
});

test('le séparateur virgule est détecté quand c’est le bon', () => {
  const csv = `Date,Description,Amount
2026-03-04,CARREFOUR MARKET,-54.20
2026-03-03,SALARY,2480.45`;
  const result = parseStatement(csv, { filename: 'x.csv', accountId: 'acc-1' });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, -54.2);
});

test('les lignes illisibles sont signalées, pas silencieusement perdues', () => {
  const csv = `Date;Libelle;Montant
04/03/2026;CARREFOUR;-54,20
pas-une-date;TRUC;-10,00
05/03/2026;;-10,00
06/03/2026;VIDE;`;
  const result = parseStatement(csv, { filename: 'x.csv', accountId: 'acc-1' });

  assert.equal(result.rows.length, 1);
  assert.equal(result.warnings.length, 3, 'chaque ligne écartée doit être signalée');
});

test('un fichier sans colonnes reconnaissables est refusé clairement', () => {
  assert.throws(
    () => parseStatement('a;b;c\n1;2;3', { filename: 'x.csv', accountId: 'acc-1' }),
    /reconnaître les colonnes/);
});

/* — OFX et QIF ————————————————————————————————————— */

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260304120000<TRNAMT>-54.20
<FITID>2026030401<NAME>CARREFOUR MARKET<MEMO>PARIS 12</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260303<TRNAMT>2480.45
<FITID>2026030301<NAME>SALAIRE</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('un fichier OFX est lu, balises non fermées comprises', () => {
  const result = parseStatement(OFX, { filename: 'releve.ofx', accountId: 'acc-1' });

  assert.equal(result.format, 'ofx');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, -54.2);
  assert.equal(result.rows[0].booked_at, '2026-03-04');
  assert.equal(result.rows[0].external_id, '2026030401');
  assert.match(result.rows[0].raw_label, /CARREFOUR MARKET/);
});

test('un fichier QIF est lu', () => {
  const qif = `!Type:Bank
D04/03/2026
T-54,20
PCARREFOUR MARKET
^
D03/03/2026
T2480,45
PSALAIRE
^`;
  const result = parseStatement(qif, { filename: 'releve.qif', accountId: 'acc-1' });
  assert.equal(result.format, 'qif');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].amount, -54.2);
});

/* — Dédoublonnage ————————————————————————————————— */

test('réimporter le même relevé produit les mêmes empreintes', () => {
  const a = parseStatement(CSV_BOURSORAMA, { filename: 'r.csv', accountId: 'acc-1' });
  const b = parseStatement(CSV_BOURSORAMA, { filename: 'r-bis.csv', accountId: 'acc-1' });
  assert.deepEqual(a.rows.map((r) => r.fingerprint), b.rows.map((r) => r.fingerprint));
});

test('deux comptes différents ne se dédoublonnent pas entre eux', () => {
  const a = parseStatement(CSV_BOURSORAMA, { filename: 'r.csv', accountId: 'acc-1' });
  const b = parseStatement(CSV_BOURSORAMA, { filename: 'r.csv', accountId: 'acc-2' });
  assert.notEqual(a.rows[0].fingerprint, b.rows[0].fingerprint);
});
