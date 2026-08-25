/**
 * WALLET · « Demande à ton patrimoine » (§33)
 *
 * Moteur LOCAL et déterministe. Aucun appel à une API payante, aucune donnée
 * financière envoyée à un tiers. Il reconnaît des intentions par motifs, va
 * chercher la réponse dans vos données, et renvoie TOUJOURS les chiffres qui
 * la justifient — pour que l'écran puisse afficher « d'où vient ce chiffre ».
 *
 * Ce n'est pas un modèle de langage : il ne devine pas, il ne bavarde pas, et
 * quand il ne comprend pas il le dit et propose ce qu'il sait faire. C'est un
 * choix, pas une limite subie : une réponse fausse sur un patrimoine coûte
 * plus cher qu'un « je ne sais pas ».
 *
 * Un modèle externe peut être branché en complément (voir setLlmBridge), mais
 * il reste facultatif et n'est jamais requis pour que l'écran fonctionne.
 */

import { deaccent } from './normalize.js';

/* — Intentions reconnues —————————————————————————————
 *
 * Chaque intention porte une PRIORITÉ. Sans elle, une question précise
 * tombe dans une intention vague : « Combien ai-je en SOL ? » contient
 * « combien … ai », donc le motif du patrimoine total l'attrape avant que
 * celui des positions ait sa chance. La priorité décide, la longueur du
 * motif reconnu départage à égalité, et `guard` permet à une intention de
 * refuser une question qu'elle ne saurait pas traiter (par exemple une
 * position sur un actif que vous ne détenez pas).
 */

export const INTENTS = [
  {
    code: 'scenario',
    priority: 100,
    patterns: [/\bsi\b[^?]*\b(btc|bitcoin|eth|ethereum|sol|solana)\b[^?]*\b(atteint|monte|arrive|vaut|passe|va a|tombe)\b/,
      /\bque vaut[^?]*\b(si|quand)\b/],
    examples: ['Que vaut mon portefeuille si BTC atteint 200 000 € ?'],
  },
  {
    code: 'net_worth_change',
    priority: 95,
    patterns: [/\b(pourquoi|comment)\b[^?]*\b(baiss|mont|chang|evolu|perdu|gagne)/,
      /\b(patrimoine|portefeuille)\b[^?]*\b(baiss|mont|perdu)/],
    examples: ['Pourquoi mon patrimoine a baissé ?'],
  },
  {
    code: 'holding_amount',
    priority: 90,
    // Ne se déclenche que si un symbole connu est effectivement cité.
    patterns: [/\bcombien\b/, /\b(ma |mes )?position/, /\bj.ai combien\b/, /\bcombien de\b/],
    guard: ({ symbol }) => Boolean(symbol),
    examples: ['Combien ai-je en SOL ?'],
  },
  {
    code: 'savings_rate',
    priority: 90,
    patterns: [/\btaux d.?epargne\b/, /\b(j.?economise|mets de cote|met de cote)\b/,
      /\bepargne\b/],
    examples: ["Quel est mon taux d'épargne ?"],
  },
  {
    code: 'risk',
    priority: 90,
    patterns: [/\b(risque|concentration|expose|diversif|danger|fragile)\b/],
    examples: ['Quel est mon principal risque ?'],
  },
  {
    code: 'subscriptions',
    priority: 85,
    patterns: [/\b(abonnement|recurrent|prelevement|souscription)s?\b/],
    examples: ['Combien me coûtent mes abonnements ?'],
  },
  {
    code: 'biggest_expense',
    priority: 85,
    patterns: [/\b(plus (grosse|grande|importante|gros)|plus cher|maximum)\b[^?]*\b(depense|achat|paiement)/,
      /\bqu.est.ce qui (me )?coute le plus\b/],
    examples: ['Quelle est ma plus grosse dépense ?'],
  },
  {
    code: 'category_spend',
    priority: 80,
    patterns: [/\b(depense|depensé|coute|paye|claque|mis|sorti)/, /\bcombien\b/],
    // Ne se déclenche que si une catégorie est réellement citée.
    guard: ({ category }) => Boolean(category),
    examples: ['Combien ai-je dépensé en restaurants ce mois-ci ?'],
  },
  {
    code: 'income',
    priority: 70,
    patterns: [/\b(revenu|salaire|gagne|touche|rentre|recu)s?\b/],
    examples: ['Combien ai-je gagné ce mois-ci ?'],
  },
  {
    code: 'score',
    priority: 70,
    patterns: [/\b(score|zone|opportunite|bon moment|acheter maintenant|faut.il acheter)\b/],
    examples: ['Est-ce un bon moment pour acheter du Bitcoin ?'],
  },
  {
    code: 'net_worth',
    priority: 40,                 // le plus vague : ne gagne qu'à défaut
    patterns: [/\bpatrimoine\b/, /\bnet worth\b/,
      /\bcombien\b[^?]*\b(je )?(vaut|vaux|possede|ai)\b/, /\bmon total\b/],
    examples: ['Combien vaut mon patrimoine ?'],
  },
];

export const SUGGESTIONS = [
  'Combien vaut mon patrimoine ?',
  'Combien ai-je dépensé en restaurants ce mois-ci ?',
  "Quel est mon taux d'épargne ?",
  'Combien me coûtent mes abonnements ?',
  'Quel est mon principal risque ?',
  'Que vaut mon portefeuille si BTC atteint 200 000 € ?',
];

/* — Reconnaissance ————————————————————————————————— */

export function normalizeQuestion(text) {
  return deaccent(String(text || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} question
 * @param {object} context  { symbol, category } — permet aux gardes de
 *                          refuser une intention qu'elles ne sauraient traiter
 * @returns {string|null} code d'intention
 */
export function detectIntent(question, context = {}) {
  const q = normalizeQuestion(question);
  let best = null;

  for (const intent of INTENTS) {
    if (intent.guard && !intent.guard(context)) continue;

    let matchLength = 0;
    for (const pattern of intent.patterns) {
      const found = q.match(pattern);
      if (found) matchLength = Math.max(matchLength, found[0].length);
    }
    if (!matchLength) continue;

    const candidate = { code: intent.code, priority: intent.priority, matchLength };
    if (!best
        || candidate.priority > best.priority
        || (candidate.priority === best.priority && candidate.matchLength > best.matchLength)) {
      best = candidate;
    }
  }

  return best?.code ?? null;
}

/** Extrait un symbole d'actif mentionné (BTC, SOL…). */
export function extractSymbol(question, knownSymbols = []) {
  const q = normalizeQuestion(question);
  const aliases = { bitcoin: 'BTC', ethereum: 'ETH', ether: 'ETH', solana: 'SOL',
    cardano: 'ADA', polkadot: 'DOT', chainlink: 'LINK', avalanche: 'AVAX', ripple: 'XRP' };

  for (const [name, symbol] of Object.entries(aliases)) {
    if (q.includes(name) && knownSymbols.includes(symbol)) return symbol;
  }
  for (const symbol of knownSymbols) {
    if (new RegExp(`\\b${symbol.toLowerCase()}\\b`).test(q)) return symbol;
  }
  return null;
}

/** Extrait un montant : « 200 000 € », « 200k », « 1,5 M ». */
export function extractAmount(question) {
  const q = normalizeQuestion(question).replace(/ | /g, ' ');

  const suffix = q.match(/(\d+(?:[.,]\d+)?)\s*([km])\b/);
  if (suffix) {
    const base = Number(suffix[1].replace(',', '.'));
    return base * (suffix[2] === 'k' ? 1000 : 1000000);
  }

  const plain = q.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:€|eur|euros|dollars?|\$)?/);
  if (plain) {
    const value = Number(plain[1].replace(/\s/g, '').replace(',', '.'));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/** Repère une catégorie citée dans la question. */
export function extractCategory(question, categories = []) {
  const q = normalizeQuestion(question);
  const synonyms = {
    restaurant: ['restaurant', 'resto', 'restau'],
    alimentation: ['course', 'alimentation', 'supermarche', 'nourriture', 'bouffe'],
    transport: ['transport', 'essence', 'carburant', 'train', 'metro', 'voiture'],
    loisirs: ['loisir', 'sortie', 'cinema', 'jeu'],
    abonnements: ['abonnement', 'souscription'],
    shopping: ['shopping', 'vetement', 'achat'],
    bar: ['bar', 'cafe', 'biere'],
    sante: ['sante', 'medecin', 'pharmacie'],
    logement: ['logement', 'loyer', 'electricite'],
    voyage: ['voyage', 'vacance', 'hotel'],
    sport: ['sport', 'salle', 'muscu'],
  };

  for (const category of categories) {
    const words = synonyms[category.slug] || [deaccent(category.label).toLowerCase()];
    if (words.some((w) => q.includes(w))) return category;
  }
  return null;
}

/* — Fenêtre temporelle ————————————————————————————— */

export function extractPeriod(question, now = new Date()) {
  const q = normalizeQuestion(question);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (/mois dernier|mois passe|le mois d.?avant/.test(q)) {
    return { label: 'le mois dernier',
      from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  }
  if (/cette annee|depuis janvier/.test(q)) {
    return { label: 'cette année', from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (/12 mois|un an|douze mois/.test(q)) {
    return { label: 'sur 12 mois', from: iso(new Date(Date.UTC(y - 1, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (/cette semaine|7 jours|sept jours/.test(q)) {
    const from = new Date(now.getTime() - 7 * 86400000);
    return { label: 'ces 7 derniers jours', from: iso(from), to: iso(now) };
  }
  return { label: 'ce mois-ci', from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
}

/* — Pont optionnel vers un modèle externe ————————— */

let llmBridge = null;
/**
 * Permet de brancher un modèle de langage SI l'utilisateur en configure un.
 * Rien n'est appelé par défaut ; aucune clé n'est fournie par WALLET.
 */
export function setLlmBridge(fn) { llmBridge = fn; }
export const hasLlmBridge = () => Boolean(llmBridge);
export const callLlm = (payload) => (llmBridge ? llmBridge(payload) : null);

/* — Fabrique de réponse ————————————————————————————— */

/**
 * Une réponse porte toujours :
 *   text     — la phrase, en langage simple
 *   evidence — les chiffres qui la justifient (affichés sous la réponse)
 *   action   — vers quel écran aller pour creuser
 *   caveat   — ce que la réponse ne dit PAS, quand c'est important
 */
export function answer({ text, evidence = [], action = null, caveat = null, intent = null }) {
  return { text, evidence, action, caveat, intent, engine: 'local', at: new Date().toISOString() };
}

export function unknownAnswer(question) {
  return answer({
    intent: null,
    text: "Je ne sais pas encore répondre à ça. Je reste volontairement limité aux questions dont je peux tirer la réponse de vos données, plutôt que de risquer une réponse inventée.",
    evidence: [],
    caveat: 'Voici ce que je sais faire :',
    action: { kind: 'suggestions', items: SUGGESTIONS },
  });
}
