/**
 * WALLET · Lecture de relevés bancaires
 *
 * Formats : CSV (avec détection du séparateur et des colonnes), OFX et QIF.
 * Le CSV français pose trois pièges que ce module traite explicitement :
 *   · séparateur point-virgule, parce que la virgule sert de décimale ;
 *   · montants « 1 234,56 » avec espace insécable comme séparateur de milliers ;
 *   · dates jj/mm/aaaa, à ne surtout pas laisser interpréter par Date().
 *
 * Chaque ligne reçoit une empreinte : réimporter un relevé qui chevauche le
 * précédent ne crée pas de doublon (contrainte unique en base).
 */

import { normalizeLabel, fingerprint } from '../engine/normalize.js';

export const SUPPORTED_FORMATS = ['csv', 'ofx', 'qif'];

/* — Reconnaissance des colonnes ————————————————————— */

const DATE_HEADERS = ['date', 'dateop', 'date operation', "date de l'operation", 'date comptable',
  'date de valeur', 'dateval', 'transaction date', 'booking date'];
const LABEL_HEADERS = ['libelle', 'label', 'description', 'intitule', 'nature de l operation',
  'libelle operation', 'details', 'memo', 'payee', 'narrative'];
const AMOUNT_HEADERS = ['montant', 'amount', 'valeur', 'somme'];
const DEBIT_HEADERS = ['debit', 'depense', 'retrait', 'sortie', 'withdrawal'];
const CREDIT_HEADERS = ['credit', 'recette', 'depot', 'entree', 'deposit'];

const simplify = (text) => normalizeLabel(text).replace(/\s+/g, ' ').trim();

export function parseStatement(text, { filename = '', accountId } = {}) {
  const extension = filename.toLowerCase().split('.').pop();
  const content = stripBom(text);

  if (extension === 'ofx' || /<OFX>/i.test(content.slice(0, 2000))) {
    return { format: 'ofx', ...withMeta(parseOfx(content, accountId)) };
  }
  if (extension === 'qif' || content.trimStart().startsWith('!Type')) {
    return { format: 'qif', ...withMeta(parseQif(content, accountId)) };
  }
  return { format: 'csv', ...withMeta(parseCsv(content, accountId)) };
}

function withMeta({ rows, warnings }) {
  const dates = rows.map((r) => r.booked_at).sort();
  return {
    rows,
    warnings,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}

const stripBom = (text) => text.replace(/^﻿/, '');

/* ================================================================== */
/* CSV                                                                 */
/* ================================================================== */

export function parseCsv(content, accountId) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) throw new Error('Fichier vide.');

  const separator = detectSeparator(lines);
  const table = lines.map((line) => splitCsvLine(line, separator));

  // L'en-tête n'est pas toujours la première ligne : Boursorama et consorts
  // ajoutent parfois des lignes de titre au-dessus.
  const headerIndex = table.findIndex((row) => scoreHeader(row) >= 2);
  if (headerIndex === -1) {
    throw new Error('Impossible de reconnaître les colonnes. Attendu : une date, un libellé et un montant.');
  }

  const header = table[headerIndex].map(simplify);
  const columns = mapColumns(header);
  if (columns.date === -1 || columns.label === -1) {
    throw new Error('Colonnes date ou libellé introuvables.');
  }
  if (columns.amount === -1 && columns.debit === -1 && columns.credit === -1) {
    throw new Error('Colonne de montant introuvable.');
  }

  const rows = [];
  const warnings = [];

  for (let i = headerIndex + 1; i < table.length; i += 1) {
    const cells = table[i];
    if (cells.length < 2) continue;

    const rawDate = cells[columns.date]?.trim();
    const rawLabel = cells[columns.label]?.trim();
    const date = parseDate(rawDate);

    if (!date) { warnings.push(`ligne ${i + 1} : date « ${rawDate ?? ''} » illisible`); continue; }
    if (!rawLabel) { warnings.push(`ligne ${i + 1} : libellé vide`); continue; }

    let amount = null;
    if (columns.amount !== -1) {
      amount = parseAmount(cells[columns.amount]);
    } else {
      const debit = parseAmount(cells[columns.debit]) ?? 0;
      const credit = parseAmount(cells[columns.credit]) ?? 0;
      // Les colonnes débit/crédit sont souvent toutes deux positives.
      amount = credit - Math.abs(debit);
    }

    if (amount === null || !Number.isFinite(amount) || amount === 0) {
      warnings.push(`ligne ${i + 1} : montant illisible ou nul`);
      continue;
    }

    rows.push(buildRow({ accountId, date, label: rawLabel, amount }));
  }

  if (!rows.length && !warnings.length) {
    warnings.push('Aucune ligne de données après l’en-tête.');
  }
  return { rows, warnings };
}

function detectSeparator(lines) {
  const candidates = [';', ',', '\t', '|'];
  let best = ';';
  let bestScore = -1;

  for (const separator of candidates) {
    const counts = lines.slice(0, 10).map((line) => splitCsvLine(line, separator).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // Un bon séparateur donne un nombre de colonnes stable d'une ligne à l'autre.
    const consistency = counts.filter((c) => c === max).length;
    const score = max * 2 + consistency;
    if (score > bestScore) { bestScore = score; best = separator; }
  }
  return best;
}

/** Découpe en respectant les guillemets et les doubles guillemets échappés. */
export function splitCsvLine(line, separator) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function scoreHeader(row) {
  const cells = row.map(simplify);
  let score = 0;
  if (cells.some((c) => DATE_HEADERS.includes(c))) score += 1;
  if (cells.some((c) => LABEL_HEADERS.includes(c))) score += 1;
  if (cells.some((c) => AMOUNT_HEADERS.includes(c)
    || DEBIT_HEADERS.includes(c) || CREDIT_HEADERS.includes(c))) score += 1;
  return score;
}

function mapColumns(header) {
  const find = (candidates) => header.findIndex((cell) => candidates.includes(cell));
  return {
    date: find(DATE_HEADERS),
    label: find(LABEL_HEADERS),
    amount: find(AMOUNT_HEADERS),
    debit: find(DEBIT_HEADERS),
    credit: find(CREDIT_HEADERS),
  };
}

/**
 * Montant français ou anglo-saxon.
 * « 1 234,56 » → 1234.56 · « 1,234.56 » → 1234.56 · « -12,50 € » → -12.5
 */
export function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim();
  if (!text) return null;

  // Montant entre parenthèses = négatif (convention comptable).
  const parenthesised = /^\((.*)\)$/.exec(text);
  if (parenthesised) text = `-${parenthesised[1]}`;

  text = text
    .replace(/[€$£\s  ]/g, '')     // symboles, espaces normales et insécables
    .replace(/[A-Za-z]/g, '');

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Le dernier des deux est la décimale, l'autre sépare les milliers.
    if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Une seule virgule : décimale si 1 à 2 chiffres suivent, milliers sinon.
    const decimals = text.length - lastComma - 1;
    text = decimals <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
  } else if (lastDot > -1) {
    const decimals = text.length - lastDot - 1;
    if (decimals === 3 && !/^-?\d{1,3}\.\d{3}$/.test(text)) text = text.replace(/\./g, '');
  }

  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/**
 * Date. Le format français jj/mm/aaaa est traité en premier : le laisser à
 * Date() donnerait le 3 avril pour 04/03/2026.
 */
export function parseDate(raw) {
  if (!raw) return null;
  const text = String(raw).trim();

  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(text);
  if (dmy) {
    let [, d, m, y] = dmy;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return isoOrNull(year, Number(m), Number(d));
  }

  const ymd = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})/.exec(text);
  if (ymd) return isoOrNull(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const compact = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  if (compact) return isoOrNull(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  return null;
}

function isoOrNull(year, month, day) {
  if (!(year >= 1990 && year <= 2100)) return null;
  if (!(month >= 1 && month <= 12)) return null;
  if (!(day >= 1 && day <= 31)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejette le 31 février et compagnie.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/* ================================================================== */
/* OFX                                                                 */
/* ================================================================== */

export function parseOfx(content, accountId) {
  const rows = [];
  const warnings = [];
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  if (!blocks.length) throw new Error('Aucune transaction trouvée dans ce fichier OFX.');

  for (const [index, block] of blocks.entries()) {
    const date = parseDate(tag(block, 'DTPOSTED'));
    const amount = parseAmount(tag(block, 'TRNAMT'));
    const label = [tag(block, 'NAME'), tag(block, 'MEMO')].filter(Boolean).join(' ').trim();

    if (!date || amount === null || !label) {
      warnings.push(`transaction ${index + 1} : champ manquant`);
      continue;
    }
    rows.push(buildRow({
      accountId, date, label, amount,
      externalId: tag(block, 'FITID') || null,
      type: tag(block, 'TRNTYPE') || null,
    }));
  }
  return { rows, warnings };
}

function tag(block, name) {
  // OFX autorise les balises non fermées : on s'arrête au retour à la ligne
  // ou à la balise suivante.
  const match = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return match ? match[1].trim() : '';
}

/* ================================================================== */
/* QIF                                                                 */
/* ================================================================== */

export function parseQif(content, accountId) {
  const rows = [];
  const warnings = [];
  const entries = content.split(/^\^\s*$/m);

  for (const [index, entry] of entries.entries()) {
    if (!entry.trim()) continue;
    const fields = {};
    for (const line of entry.split(/\r?\n/)) {
      const code = line[0];
      if (!code || code === '!') continue;
      fields[code] = (fields[code] ? `${fields[code]} ` : '') + line.slice(1).trim();
    }

    const date = parseDate(fields.D);
    const amount = parseAmount(fields.T ?? fields.U);
    const label = [fields.P, fields.M].filter(Boolean).join(' ').trim();

    if (!date || amount === null || !label) {
      if (Object.keys(fields).length) warnings.push(`entrée ${index + 1} : champ manquant`);
      continue;
    }
    rows.push(buildRow({ accountId, date, label, amount }));
  }

  if (!rows.length) throw new Error('Aucune transaction trouvée dans ce fichier QIF.');
  return { rows, warnings };
}

/* ================================================================== */
/* Ligne normalisée                                                    */
/* ================================================================== */

function buildRow({ accountId, date, label, amount, externalId = null, type = null }) {
  const clean = normalizeLabel(label);
  return {
    account_id: accountId,
    booked_at: date,
    value_at: date,
    amount,
    currency: 'EUR',
    raw_label: label,
    clean_label: clean,
    merchant: clean,
    operation_type: type || guessOperationType(label),
    status: 'active',
    external_id: externalId,
    fingerprint: fingerprint({ account_id: accountId, booked_at: date, amount, raw_label: label }),
  };
}

function guessOperationType(label) {
  const text = label.toUpperCase();
  if (/^(CB|CARTE|PAIEMENT CB)/.test(text)) return 'CARTE';
  if (/^(VIR|VIREMENT)/.test(text)) return 'VIR';
  if (/^(PRLV|PRELEVEMENT)/.test(text)) return 'PRLV';
  if (/^(CHQ|CHEQUE)/.test(text)) return 'CHQ';
  if (/RETRAIT|DAB/.test(text)) return 'RETRAIT';
  return null;
}
