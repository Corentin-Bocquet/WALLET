/**
 * WALLET · Moteur de catégorisation (§9 à §17)
 *
 * Ordre de décision, du plus fort au plus faible. Le premier qui répond gagne,
 * et il expose TOUJOURS sa raison, pour que l'écran puisse répondre à
 * « pourquoi cette catégorie ? » (§47).
 *
 *   1. RÈGLE utilisateur          confiance 1.00   — vous l'avez écrite
 *   2. MÉMOIRE ciblée             0.70 → 0.97      — vos corrections passées,
 *                                                    au bon seau de montant
 *   3. MÉMOIRE généralisée        0.62 → 0.88      — vos corrections passées,
 *                                                    tous montants confondus
 *   4. RÉCURRENCE reconnue        0.85             — abonnement déjà identifié
 *   5. HEURISTIQUE lexicale       0.40 → 0.80      — dictionnaire de marchands
 *   6. rien                       0.00             — mis en file « à classer »
 *
 * Aucune IA payante n'est requise : les niveaux 1 à 4 sont vos propres données,
 * le niveau 5 est un dictionnaire local. Un classifieur optionnel peut être
 * branché en niveau 5bis (voir `setFallbackClassifier`).
 */

import { normalizeLabel, amountBucket, BUCKETS } from './normalize.js';

/* ------------------------------------------------------------------ */
/* Dictionnaire lexical de départ                                      */
/*   Volontairement compact : c'est un point de départ, pas une base de */
/*   connaissances. Le vrai savoir vient de vos corrections.           */
/* ------------------------------------------------------------------ */
export const LEXICON = {
  alimentation: ['carrefour', 'leclerc', 'lidl', 'auchan', 'intermarche', 'monoprix',
    'casino', 'franprix', 'aldi', 'picard', 'grand frais', 'biocoop', 'naturalia',
    'super u', 'hyper u', 'g20', 'spar', 'boulangerie', 'boucherie', 'primeur',
    'marche', 'epicerie', 'cora', 'match'],
  restaurant: ['restaurant', 'mcdonald', 'burger king', 'kfc', 'subway', 'quick',
    'pizza', 'sushi', 'kebab', 'brasserie', 'bistro', 'deliveroo', 'just eat',
    'uber eats', 'ubereats', 'tacos', 'traiteur', 'pizzeria', 'creperie', 'poke'],
  bar: ['bar', 'cafe', 'pub', 'brewery', 'taproom', 'starbucks', 'columbus cafe',
    'comptoir', 'bistrot', 'tabac'],
  alcool: ['nicolas', 'cave', 'vin', 'wine', 'biere', 'brasserie artisanale',
    'v and b', 'la cave', 'spiritueux'],
  transport: ['uber', 'bolt', 'sncf', 'ratp', 'navigo', 'blablacar', 'flixbus',
    'total energies', 'totalenergies', 'esso', 'shell', 'bp ', 'station',
    'parking', 'peage', 'vinci autoroutes', 'sanef', 'aprr', 'taxi', 'freenow',
    'lime', 'tier', 'velib', 'carburant', 'garage', 'norauto', 'feu vert'],
  logement: ['loyer', 'edf', 'engie', 'total direct energie', 'veolia', 'suez',
    'saur', 'foncia', 'nexity', 'orpi', 'century 21', 'syndic', 'charges',
    'assurance habitation', 'maaf', 'macif habitation', 'ikea', 'leroy merlin',
    'castorama', 'bricorama'],
  abonnements: ['netflix', 'spotify', 'deezer', 'disney', 'canal', 'amazon prime',
    'apple.com/bill', 'itunes', 'google', 'youtube premium', 'free mobile',
    'orange', 'sfr', 'bouygues', 'sosh', 'red by sfr', 'icloud', 'dropbox',
    'adobe', 'microsoft', 'openai', 'anthropic', 'notion', 'github', 'nordvpn',
    'audible', 'kindle unlimited', 'molotov', 'crunchyroll'],
  loisirs: ['cinema', 'ugc', 'pathe', 'gaumont', 'cgr', 'fnac spectacles',
    'ticketmaster', 'steam', 'playstation', 'xbox', 'nintendo', 'concert',
    'theatre', 'musee', 'parc', 'bowling', 'laser game', 'escape'],
  shopping: ['amazon', 'fnac', 'darty', 'boulanger', 'zalando', 'asos', 'zara',
    'h&m', 'hm ', 'uniqlo', 'nike', 'adidas', 'shein', 'vinted', 'leboncoin',
    'cdiscount', 'aliexpress', 'temu', 'action', 'gifi', 'sephora', 'nocibe',
    'kiabi', 'jules', 'celio', 'primark'],
  voyage: ['airbnb', 'booking', 'hotel', 'ryanair', 'easyjet', 'air france',
    'transavia', 'vueling', 'lufthansa', 'expedia', 'trivago', 'hostel',
    'camping', 'club med', 'voyages sncf', 'trainline'],
  sante: ['pharmacie', 'doctolib', 'medecin', 'docteur', 'dentiste', 'laboratoire',
    'biogroup', 'cerballiance', 'opticien', 'krys', 'afflelou', 'grandoptical',
    'mutuelle', 'harmonie', 'cpam', 'ameli', 'kine', 'osteopathe', 'hopital',
    'clinique', 'radiologie'],
  etudes: ['universite', 'ecole', 'crous', 'scolarite', 'campus', 'formation',
    'udemy', 'coursera', 'openclassrooms', 'librairie', 'gibert'],
  sport: ['decathlon', 'basic fit', 'basic-fit', 'fitness park', 'neoness',
    'keepcool', 'salle de sport', 'intersport', 'go sport', 'strava',
    'piscine', 'tennis', 'padel', 'escalade'],
  'frais-bancaires': ['cotisation', 'frais', 'commission', 'agios', 'interets debiteurs',
    'tenue de compte', 'carte bancaire cotisation'],
  impots: ['dgfip', 'impot', 'tresor public', 'urssaf', 'taxe', 'amende', 'antai'],
  cadeaux: ['cadeau', 'don ', 'donation', 'unicef', 'croix rouge', 'telethon',
    'fleuriste', 'interflora'],
  salaire: ['salaire', 'paie', 'paye', 'remuneration', 'traitement', 'solde de tout compte'],
  remboursement: ['remboursement', 'rbt', 'avoir', 'refund', 'cpam', 'mutuelle',
    'indemnite'],
  dividendes: ['dividende', 'coupon', 'interets crediteurs', 'interets livret'],
  investissement: ['kraken', 'okx', 'binance', 'coinbase', 'bitstamp', 'trade republic',
    'boursorama bourse', 'degiro', 'etoro', 'bitpanda', 'pea', 'assurance vie',
    'linxea', 'yomoni', 'nalo'],
  transfert: ['virement interne', 'vir compte', 'transfert', 'epargne',
    'livret a', 'ldds', 'lep ', 'compte joint'],
};

/** Familles proches, pour proposer des alternatives crédibles quand on hésite. */
const NEIGHBOURS = {
  restaurant: ['bar', 'alimentation', 'alcool'],
  bar: ['restaurant', 'alcool', 'loisirs'],
  alcool: ['bar', 'alimentation', 'restaurant'],
  alimentation: ['restaurant', 'shopping'],
  shopping: ['alimentation', 'loisirs', 'sport'],
  transport: ['voyage', 'shopping'],
  voyage: ['transport', 'loisirs'],
  loisirs: ['shopping', 'bar', 'voyage'],
};

/* ------------------------------------------------------------------ */
/* Classifieur optionnel (§14)                                         */
/*   Reste vide par défaut. Aucun service payant n'est appelé.         */
/* ------------------------------------------------------------------ */
let fallbackClassifier = null;
export function setFallbackClassifier(fn) { fallbackClassifier = fn; }

/* ------------------------------------------------------------------ */
/* Confiance                                                           */
/* ------------------------------------------------------------------ */

/**
 * Confiance issue de la mémoire.
 * Croît vite sur les 3 premières confirmations puis sature : après cinq fois,
 * une sixième n'apporte presque rien, et on ne prétend jamais à 100 % (seule
 * une règle écrite par vous vaut 1.0).
 */
export function memoryConfidence({ hits = 0, corrections = 0, exactBucket = true, competing = 0 }) {
  const support = hits + corrections * 2;
  const base = 1 - Math.exp(-support / 3.2);          // 0 → ~0.96
  const ceiling = exactBucket ? 0.97 : 0.88;
  const floor = exactBucket ? 0.70 : 0.62;
  // La présence d'une catégorie concurrente sur la même clé fait douter.
  const rivalry = competing > 0 ? 1 - Math.min(0.35, competing / (support + competing)) : 1;
  return round3(Math.max(0, Math.min(ceiling, floor + (ceiling - floor) * base * rivalry)));
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------------------ */
/* Correspondances                                                     */
/* ------------------------------------------------------------------ */

function ruleMatches(rule, tx, cleanLabel) {
  if (rule.is_active === false) return false;
  if (rule.account_id && rule.account_id !== tx.account_id) return false;
  if (rule.sign === 'debit' && tx.amount >= 0) return false;
  if (rule.sign === 'credit' && tx.amount < 0) return false;

  const abs = Math.abs(tx.amount);
  if (rule.amount_min != null && abs < rule.amount_min) return false;
  if (rule.amount_max != null && abs > rule.amount_max) return false;

  const haystackRaw = String(tx.raw_label || '').toLowerCase();
  const haystack = `${cleanLabel} ${haystackRaw}`;
  const pattern = String(rule.pattern || '').toLowerCase().trim();
  if (!pattern) return false;

  switch (rule.match_type) {
    case 'equals':      return cleanLabel === pattern;
    case 'starts_with': return cleanLabel.startsWith(pattern);
    case 'iban':        return String(tx.counterparty_iban || '').toLowerCase().includes(pattern);
    case 'regex':
      try { return new RegExp(rule.pattern, 'i').test(tx.raw_label || ''); }
      catch { return false; }
    case 'contains':
    default:            return haystack.includes(pattern);
  }
}

/**
 * Score lexical : longueur du terme trouvé, rapportée au libellé.
 *
 * Un terme court n'est accepté QUE s'il forme un mot entier. Sans cette
 * garde, « bar » attraperait « BARBARA MARTIN » et « vin » attraperait
 * « VINCI AUTOROUTES ». Les termes longs (≥ 6 caractères) restent acceptés en
 * sous-chaîne, ce qui rattrape les libellés collés du type « AMAZONFR ».
 */
const MIN_SUBSTRING_LENGTH = 6;

function lexicalMatch(cleanLabel) {
  let best = null;
  for (const [slug, terms] of Object.entries(LEXICON)) {
    for (const term of terms) {
      const needle = term.trim();
      const idx = cleanLabel.indexOf(needle);
      if (idx === -1) continue;

      const wholeWord = isWholeWord(cleanLabel, needle, idx);
      if (!wholeWord && needle.length < MIN_SUBSTRING_LENGTH) continue;

      const coverage = needle.length / Math.max(cleanLabel.length, 1);
      const score = needle.length * (wholeWord ? 1.6 : 0.5)
                  + coverage * 8
                  + (idx === 0 ? 3 : 0);
      if (!best || score > best.score) best = { slug, term: needle, score, wholeWord };
    }
  }
  return best;
}

function isWholeWord(text, term, idx) {
  const before = idx === 0 ? ' ' : text[idx - 1];
  const after = idx + term.length >= text.length ? ' ' : text[idx + term.length];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

function lexicalConfidence(match) {
  if (!match) return 0;
  // 0.40 pour une correspondance faible, 0.80 pour un terme long et isolé.
  const raw = 0.4 + Math.min(0.4, (match.score - 4) / 30);
  return round3(Math.max(0.4, Math.min(0.8, raw)));
}

/* ------------------------------------------------------------------ */
/* Fonction principale                                                 */
/* ------------------------------------------------------------------ */

/**
 * @param {object} tx        transaction { amount, raw_label, clean_label, account_id, counterparty_iban }
 * @param {object} context   { rules, memory, ignoreMemory, recurring, categoriesBySlug, categoriesById, settings }
 * @returns {object} { categoryId, slug, source, confidence, reason, alternatives, suggestIgnore }
 */
export function categorize(tx, context = {}) {
  const {
    rules = [],
    memory = [],
    ignoreMemory = [],
    recurring = [],
    categoriesBySlug = new Map(),
    categoriesById = new Map(),
    askBelow = 0.6,
  } = context;

  const cleanLabel = tx.clean_label || normalizeLabel(tx.raw_label);
  const key = (tx.merchant || cleanLabel || '').trim();
  const bucket = amountBucket(tx.amount);

  const result = (partial) => finalize(partial, {
    tx, key, bucket, cleanLabel, ignoreMemory, categoriesById, categoriesBySlug, askBelow,
  });

  /* 1. Règles utilisateur ------------------------------------------- */
  const sorted = rules.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const rule of sorted) {
    if (ruleMatches(rule, tx, cleanLabel)) {
      return result({
        categoryId: rule.category_id,
        source: 'rule',
        confidence: 1,
        reason: {
          kind: 'rule',
          label: `Votre règle « ${rule.pattern} »`,
          detail: 'Vous avez demandé à classer ces transactions ici.',
          ruleId: rule.id,
        },
      });
    }
  }

  /* 2 et 3. Mémoire -------------------------------------------------- */
  const relevant = memory.filter((m) => m.key_value === key);
  if (relevant.length) {
    const exact = pickBest(relevant.filter((m) => m.amount_bucket === bucket));
    const general = pickBest(relevant.filter((m) => m.amount_bucket === 'any'));
    const chosen = exact || general;

    if (chosen) {
      const isExact = Boolean(exact);
      const pool = relevant.filter((m) => m.amount_bucket === (isExact ? bucket : 'any'));
      const competing = pool.filter((m) => m.category_id !== chosen.category_id)
        .reduce((a, m) => a + (m.hits || 0), 0);

      const confidence = memoryConfidence({
        hits: chosen.hits, corrections: chosen.corrections,
        exactBucket: isExact, competing,
      });

      return result({
        categoryId: chosen.category_id,
        source: 'memory',
        confidence,
        reason: {
          kind: 'memory',
          label: isExact
            ? `Comme vos ${chosen.hits} précédents « ${key} » de ce montant`
            : `Comme vos précédents « ${key} »`,
          detail: chosen.corrections > 0
            ? `Vous avez corrigé cette catégorie ${chosen.corrections} fois. WALLET s'en souvient.`
            : 'Appris automatiquement de votre historique.',
          hits: chosen.hits,
          corrections: chosen.corrections,
          bucket: isExact ? bucket : 'any',
        },
      });
    }
  }

  /* 4. Récurrence déjà identifiée ----------------------------------- */
  const rec = recurring.find((r) => r.is_active !== false && r.merchant === key && r.category_id);
  if (rec) {
    return result({
      categoryId: rec.category_id,
      source: 'recurring',
      confidence: 0.85,
      reason: {
        kind: 'recurring',
        label: `Paiement récurrent « ${rec.label} »`,
        detail: `Détecté ${rec.occurrences} fois, environ tous les mois.`,
      },
    });
  }

  /* 5. Heuristique lexicale ------------------------------------------ */
  const lex = lexicalMatch(cleanLabel);
  if (lex) {
    const category = categoriesBySlug.get(lex.slug);
    if (category) {
      return result({
        categoryId: category.id,
        source: 'heuristic',
        confidence: lexicalConfidence(lex),
        reason: {
          kind: 'heuristic',
          label: `Le libellé contient « ${lex.term} »`,
          detail: "Classement par défaut. Corrigez-le si besoin : WALLET retiendra votre choix.",
          term: lex.term,
        },
      });
    }
  }

  /* 5bis. Classifieur optionnel -------------------------------------- */
  if (fallbackClassifier) {
    const guess = fallbackClassifier({ cleanLabel, amount: tx.amount, bucket });
    if (guess?.slug && categoriesBySlug.has(guess.slug)) {
      return result({
        categoryId: categoriesBySlug.get(guess.slug).id,
        source: 'model',
        confidence: round3(Math.min(0.75, guess.confidence ?? 0.5)),
        reason: {
          kind: 'model',
          label: 'Proposition du classifieur local',
          detail: guess.detail || 'Suggestion automatique, à confirmer.',
        },
      });
    }
  }

  /* 6. Rien ---------------------------------------------------------- */
  const fallback = categoriesBySlug.get(tx.amount >= 0 ? 'revenus' : 'autres');
  return result({
    categoryId: fallback?.id ?? null,
    source: 'none',
    confidence: 0,
    reason: {
      kind: 'none',
      label: 'Aucune correspondance',
      detail: "WALLET ne sait pas encore. Dites-lui une fois, il retiendra.",
    },
  });
}

function pickBest(entries) {
  if (!entries.length) return null;
  return entries.slice().sort((a, b) => {
    const byHits = (b.hits || 0) - (a.hits || 0);
    if (byHits) return byHits;
    return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0);
  })[0];
}

function finalize(partial, ctx) {
  const { tx, key, bucket, ignoreMemory, categoriesById, categoriesBySlug, askBelow } = ctx;
  const category = partial.categoryId ? categoriesById.get(partial.categoryId) : null;

  /* Apprentissage des exclusions (§13) : on SUGGÈRE, on n'agit jamais seul. */
  const ignoreEntry = ignoreMemory.find(
    (m) => m.key_value === key && (m.amount_bucket === bucket || m.amount_bucket === 'any'));
  let suggestIgnore = null;
  if (ignoreEntry && ignoreEntry.ignored_count >= 3
      && ignoreEntry.ignored_count > (ignoreEntry.kept_count || 0) * 2) {
    suggestIgnore = {
      label: `Vous avez déjà écarté ${ignoreEntry.ignored_count} dépenses « ${key} » de ce type.`,
      detail: 'Voulez-vous exclure celle-ci de vos analyses ? Elle restera dans votre historique.',
      count: ignoreEntry.ignored_count,
    };
  }

  const needsConfirmation = partial.confidence < askBelow;

  return {
    ...partial,
    slug: category?.slug ?? null,
    label: category?.label ?? null,
    emoji: category?.emoji ?? '❓',
    color: category?.color ?? 'var(--neutral)',
    bucket,
    key,
    needsConfirmation,
    suggestIgnore,
    alternatives: alternativesFor(category?.slug, categoriesBySlug, tx),
  };
}

function alternativesFor(slug, categoriesBySlug, tx) {
  const pool = NEIGHBOURS[slug] || (tx.amount >= 0
    ? ['salaire', 'remboursement', 'dividendes']
    : ['alimentation', 'restaurant', 'shopping', 'transport']);
  return pool
    .filter((s) => s !== slug)
    .map((s) => categoriesBySlug.get(s))
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Transactions auxquelles une correction pourrait être étendue.
 *
 * Le filtre par ordre de grandeur est essentiel : la mémoire vient d'apprendre
 * un choix POUR CE SEAU DE MONTANT. Étendre la correction à tous les montants
 * annulerait l'exception que le moteur cherche justement à préserver (§12).
 *
 * Les transactions déjà corrigées à la main sont exclues : un choix explicite
 * ne se fait pas écraser par un autre choix explicite.
 *
 * @param {Array}  transactions  toutes les transactions connues
 * @param {object} options       { excludeId, key, bucket, categoryId }
 */
export function selectSimilarTransactions(transactions, {
  excludeId, key, bucket, categoryId,
} = {}) {
  if (!key) return [];
  return (transactions || []).filter((tx) => {
    if (tx.id === excludeId) return false;
    if ((tx.merchant || tx.clean_label) !== key) return false;
    if (bucket && amountBucket(tx.amount) !== bucket) return false;
    if (tx.category_source === 'user') return false;
    return tx.category_id !== categoryId;
  });
}

export { BUCKETS };
