/**
 * WALLET · Écran « Demande à ton patrimoine » (§33)
 *
 * Chaque réponse affiche les chiffres qui la fondent, et un lien pour aller
 * voir soi-même. Une réponse sans justification serait pire qu'inutile sur un
 * sujet financier.
 */

import { h, mount } from '../lib/dom.js';
import { glyph } from '../components/icons.js';
import { openSheet } from '../lib/sheet.js';
import { navigate } from '../lib/router.js';
import { feedback } from '../lib/feedback.js';
import { money, pct, num, day as fmtDay } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import {
  detectIntent, extractSymbol, extractCategory, extractAmount, extractPeriod,
  answer, unknownAnswer, SUGGESTIONS,
} from '../engine/assistant.js';
import { projectPortfolio } from '../engine/scenarios.js';
import { computeIndicators } from '../engine/indicators.js';
import { computeInvestmentScore, ZONE_META } from '../engine/score.js';
import { monthlyRecurringCost } from '../engine/recurring.js';

export function openAssistant(initialQuestion = null) {
  openSheet({
    title: 'Demande à ton patrimoine',
    label: 'Assistant',
    build: ({ close }) => buildPanel(close, initialQuestion),
  });
}

function buildPanel(close, initialQuestion) {
  const thread = h('div', { style: { display: 'grid', gap: '14px' } });
  const container = h('div');

  const input = h('input', {
    type: 'text',
    placeholder: 'Posez votre question…',
    'aria-label': 'Votre question',
    enterkeyhint: 'send',
    autocomplete: 'off',
  });

  const form = h('form', {
    style: { display: 'flex', gap: '10px', marginTop: '20px', position: 'sticky', bottom: '0',
      background: 'var(--bg-elevated)', paddingBlock: '12px' },
    onsubmit: (event) => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      ask(question);
    },
  },
    h('div.field', { style: { flex: '1', margin: '0' } }, input),
    h('button.btn.btn--primary', { type: 'submit', 'data-sound': 'select',
      style: { minWidth: '56px', padding: '0 18px' }, 'aria-label': 'Envoyer' }, glyph('arrowUp')),
  );

  mount(container,
    h('p.muted', { style: { fontSize: 'var(--fs-sm)' } },
      'Les questions courantes sont calculées sur votre appareil. Pour les autres, seuls des totaux — jamais vos opérations — sont envoyés à l’IA.'),
    thread,
    suggestionChips(ask),
    form,
  );

  async function ask(question) {
    feedback.select();
    thread.append(bubble(question, 'user'));

    const pending = h('div.card', h('span.muted', 'Je regarde…'));
    thread.append(pending);
    pending.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    let result;
    try {
      result = await resolve(question);
    } catch (error) {
      result = answer({
        text: "Je n'ai pas réussi à aller chercher la réponse. La source de données est peut-être indisponible.",
        caveat: error.message,
      });
    }

    // Le moteur local couvre les questions cadrées. Pour tout le reste, on
    // passe la main à l'IA plutôt que de répondre « je ne sais pas ».
    if (!result?.intent && !repo.isDemoMode()) {
      pending.replaceWith(h('div.card', h('span.muted', 'Je réfléchis…')));
      const thinking = thread.lastElementChild;
      try {
        const remote = await repo.askAssistant(question);
        result = {
          intent: 'llm',
          text: remote?.answer || result.text,
          evidence: remote?.evidence ?? [],
          caveat: 'Réponse rédigée par une IA à partir de vos totaux. Vérifiez ce qui compte.',
          action: null,
        };
      } catch (error) {
        result = { ...result, caveat: error.message };
      }
      thinking.replaceWith(renderAnswer(result, { close, ask }));
    } else {
      pending.replaceWith(renderAnswer(result, { close, ask }));
    }
    repo.logAssistant?.({ role: 'user', content: question, intent: result.intent, engine: 'local' })
      .catch(() => {});
  }

  if (initialQuestion) queueMicrotask(() => ask(initialQuestion));
  return container;
}

function suggestionChips(ask) {
  return h('div.hscroll', { style: { marginTop: '16px' } },
    SUGGESTIONS.map((s) => h('button.badge', {
      type: 'button', 'data-sound': 'tap',
      style: { padding: '10px 14px', fontSize: 'var(--fs-sm)', fontWeight: '500' },
      onclick: () => ask(s),
    }, s)),
  );
}

function bubble(text, who) {
  return h('div', {
    style: {
      justifySelf: who === 'user' ? 'end' : 'start',
      maxWidth: '85%',
      background: who === 'user' ? 'var(--accent)' : 'var(--surface)',
      color: who === 'user' ? 'var(--text-on-accent)' : 'var(--text)',
      padding: '12px 16px',
      borderRadius: 'var(--r-lg)',
      fontWeight: who === 'user' ? '600' : '400',
    },
  }, text);
}

function renderAnswer(result, { close, ask }) {
  return h('div.card',
    h('p', result.text),

    result.evidence?.length
      ? h('div.rows', { style: { marginTop: '16px' } },
          result.evidence.map((item) => h('div.row', { style: { gridTemplateColumns: '1fr auto', minHeight: '44px' } },
            h('div.row__main', h('div.row__sub', { style: { whiteSpace: 'normal' } }, item.label)),
            h('div.row__end', h('div.row__value', item.value)),
          )))
      : null,

    result.caveat
      ? h('p.explain__source', { style: { marginTop: '14px' } }, result.caveat)
      : null,

    result.action?.kind === 'navigate'
      ? h('button.btn.btn--secondary.btn--block', {
          type: 'button', style: { marginTop: '16px' }, 'data-sound': 'select',
          onclick: () => { close(); navigate(result.action.path); },
        }, result.action.label)
      : null,

    result.action?.kind === 'suggestions'
      ? h('div.hscroll', { style: { marginTop: '12px' } },
          result.action.items.map((s) => h('button.badge', {
            type: 'button', 'data-sound': 'tap',
            style: { padding: '10px 14px', fontSize: 'var(--fs-sm)' },
            onclick: () => ask(s),
          }, s)))
      : null,
  );
}

/* ================================================================== */
/* Résolution des intentions                                           */
/* ================================================================== */

export async function resolve(question) {
  const [holdings, categories] = await Promise.all([
    repo.getHoldings().catch(() => []),
    repo.listCategories().catch(() => []),
  ]);

  const symbols = holdings.map((h2) => h2.symbol).filter(Boolean);
  const symbol = extractSymbol(question, symbols.length ? symbols : ['BTC', 'ETH', 'SOL']);
  const category = extractCategory(question, categories);
  const intent = detectIntent(question, { symbol, category });

  switch (intent) {
    case 'net_worth':        return answerNetWorth();
    case 'net_worth_change': return answerNetWorthChange();
    case 'holding_amount':   return answerHolding(symbol, holdings);
    case 'category_spend':   return answerCategorySpend(question, category);
    case 'savings_rate':     return answerSavingsRate(question);
    case 'income':           return answerIncome(question);
    case 'subscriptions':    return answerSubscriptions();
    case 'biggest_expense':  return answerBiggestExpense(question);
    case 'scenario':         return answerScenario(question, holdings);
    case 'risk':             return answerRisk(holdings);
    case 'score':            return answerScore(symbol || 'BTC');
    default:                 return unknownAnswer(question);
  }
}

async function answerNetWorth() {
  const nw = await repo.getNetWorth();
  const parts = [
    { label: 'Crypto', value: money(nw.crypto) },
    { label: 'Liquidités', value: money(nw.cash) },
  ];
  if (nw.equity > 0) parts.push({ label: 'Actions', value: money(nw.equity) });
  if (Number.isFinite(nw.change_30d)) {
    parts.push({ label: 'Sur 30 jours', value: `${money(nw.change_30d, { sign: true })} (${pct(nw.change_30d_pct)})` });
  }

  return answer({
    intent: 'net_worth',
    text: `Votre patrimoine est de ${money(nw.total)}.`,
    evidence: parts,
    caveat: nw.is_partial
      ? `Attention : ${nw.unknown.length} source(s) n'ont pas pu être valorisées. Ce total est donc partiel, et ces sources ne sont pas comptées comme 0 €.`
      : null,
    action: { kind: 'navigate', path: '/portefeuille', label: 'Voir le détail' },
  });
}

async function answerNetWorthChange() {
  const nw = await repo.getNetWorth();
  const series = nw.series || [];
  if (series.length < 2) {
    return answer({
      intent: 'net_worth_change',
      text: "Je n'ai pas encore assez d'historique pour expliquer une variation.",
      caveat: 'Il faut au moins deux relevés de patrimoine.',
    });
  }

  const last = Number(series[series.length - 1].total_value ?? series[series.length - 1].total);
  const previous = Number(series[series.length - 2].total_value ?? series[series.length - 2].total);
  const delta = last - previous;

  // On attribue la variation aux positions, à partir de leur variation 24 h.
  const holdings = await repo.getHoldings().catch(() => []);
  const contributions = holdings
    .filter((hold) => Number.isFinite(hold.value) && Number.isFinite(hold.change_24h))
    .map((hold) => ({
      symbol: hold.symbol,
      // valeur actuelle − valeur d'hier reconstituée depuis la variation
      contribution: hold.value - hold.value / (1 + hold.change_24h / 100),
      change: hold.change_24h,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const main = contributions[0];
  const direction = delta >= 0 ? 'monté' : 'baissé';

  return answer({
    intent: 'net_worth_change',
    text: main
      ? `Votre patrimoine a ${direction} de ${money(Math.abs(delta))}. La plus grosse contribution vient de ${main.symbol} (${pct(main.change)}).`
      : `Votre patrimoine a ${direction} de ${money(Math.abs(delta))}.`,
    evidence: contributions.slice(0, 4).map((c) => ({
      label: `${c.symbol} · ${pct(c.change)}`,
      value: money(c.contribution, { sign: true }),
    })),
    caveat: 'Les soldes bancaires ne bougent qu’à la synchronisation : une variation intra-journalière vient presque toujours des actifs cotés.',
    action: { kind: 'navigate', path: '/portefeuille', label: 'Voir mes positions' },
  });
}

function answerHolding(symbol, holdings) {
  const position = holdings.find((hold) => hold.symbol === symbol);
  if (!position) {
    return answer({
      intent: 'holding_amount',
      text: `Vous ne détenez pas de ${symbol}, ou cette position n'est pas encore synchronisée.`,
      action: { kind: 'navigate', path: '/portefeuille', label: 'Voir mon portefeuille' },
    });
  }

  const evidence = [
    { label: 'Quantité', value: `${num(position.quantity)} ${symbol}` },
    { label: 'Prix actuel', value: money(position.price) },
  ];
  if (Number.isFinite(position.pnl)) {
    evidence.push({ label: 'Prix de revient', value: money(position.avg_cost) });
    evidence.push({ label: 'Plus/moins-value', value: `${money(position.pnl, { sign: true })} (${pct(position.pnl_pct)})` });
  }

  return answer({
    intent: 'holding_amount',
    text: `Vous avez ${num(position.quantity)} ${symbol}, soit ${money(position.value)}.`,
    evidence,
    action: { kind: 'navigate', path: `/marches/${position.asset_id}`, label: `Voir ${symbol}` },
  });
}

async function answerCategorySpend(question, category) {
  const period = extractPeriod(question);
  const rows = await repo.listTransactions({ from: period.from, to: period.to, limit: 2000 });

  const matching = rows.filter((tx) => tx.status === 'active'
    && tx.amount < 0 && tx.category_id === category.id);
  const total = matching.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  if (!matching.length) {
    return answer({
      intent: 'category_spend',
      text: `Aucune dépense en ${category.label.toLowerCase()} ${period.label}.`,
      caveat: 'Zéro dépense enregistrée — ce n’est pas la même chose qu’une donnée manquante.',
    });
  }

  const biggest = matching.slice().sort((a, b) => a.amount - b.amount)[0];

  return answer({
    intent: 'category_spend',
    text: `Vous avez dépensé ${money(total)} en ${category.label.toLowerCase()} ${period.label}.`,
    evidence: [
      { label: 'Nombre de dépenses', value: String(matching.length) },
      { label: 'Panier moyen', value: money(total / matching.length) },
      { label: 'La plus grosse', value: `${money(Math.abs(biggest.amount))} · ${fmtDay(biggest.booked_at)}` },
    ],
    action: { kind: 'navigate', path: `/banque?categorie=${category.id}`, label: 'Voir ces dépenses' },
  });
}

async function answerSavingsRate(question) {
  const period = extractPeriod(question);
  const summary = await repo.monthlySummary(period.from);
  if (!summary) {
    return answer({ intent: 'savings_rate', text: "Je n'ai pas de données pour cette période." });
  }

  if (summary.savings_rate === null) {
    return answer({
      intent: 'savings_rate',
      text: `Je ne peux pas calculer votre taux d'épargne ${period.label} : aucun revenu n'est enregistré sur la période.`,
      caveat: "Un taux d'épargne sans revenu connu n'a pas de sens — je préfère ne rien afficher plutôt que 0 %.",
      evidence: [{ label: 'Dépenses', value: money(Number(summary.expense)) }],
    });
  }

  return answer({
    intent: 'savings_rate',
    text: `Votre taux d'épargne ${period.label} est de ${Math.round(Number(summary.savings_rate))} %.`,
    evidence: [
      { label: 'Revenus', value: money(Number(summary.income)) },
      { label: 'Dépenses', value: money(Number(summary.expense)) },
      { label: 'Épargne nette', value: money(Number(summary.net_savings)) },
    ],
    caveat: 'Les virements entre vos propres comptes sont exclus : se virer de l’argent n’est ni un revenu ni une dépense.',
    action: { kind: 'navigate', path: '/banque', label: 'Voir mes comptes' },
  });
}

async function answerIncome(question) {
  const period = extractPeriod(question);
  const summary = await repo.monthlySummary(period.from);
  if (!summary || !Number(summary.income)) {
    return answer({
      intent: 'income',
      text: `Aucun revenu enregistré ${period.label}.`,
      caveat: 'Vos revenus apparaîtront dès qu’un relevé sera importé ou synchronisé.',
    });
  }
  return answer({
    intent: 'income',
    text: `Vous avez reçu ${money(Number(summary.income))} ${period.label}.`,
    evidence: [
      { label: 'Dépenses sur la période', value: money(Number(summary.expense)) },
      { label: 'Reste', value: money(Number(summary.net_savings)) },
    ],
    action: { kind: 'navigate', path: '/banque', label: 'Voir le détail' },
  });
}

async function answerSubscriptions() {
  const recurring = await repo.listRecurring();
  const active = recurring.filter((r) => r.is_active && r.direction !== 'credit');
  if (!active.length) {
    return answer({
      intent: 'subscriptions',
      text: "Je n'ai détecté aucun paiement récurrent pour l'instant.",
      caveat: 'Il faut au moins trois passages réguliers pour qu’un prélèvement soit reconnu comme récurrent.',
    });
  }

  const monthly = monthlyRecurringCost(active);
  const top = active.slice().sort((a, b) => Number(b.average_amount) - Number(a.average_amount)).slice(0, 5);

  return answer({
    intent: 'subscriptions',
    text: `Vos ${active.length} paiements récurrents vous coûtent environ ${money(monthly)} par mois, soit ${money(monthly * 12)} par an.`,
    evidence: top.map((r) => ({
      label: `${r.label} · ${r.cadence === 'monthly' ? 'mensuel' : r.cadence}`,
      value: money(Number(r.average_amount)),
    })),
    caveat: 'Les cadences non mensuelles sont ramenées à une base mensuelle pour permettre la comparaison.',
    action: { kind: 'navigate', path: '/banque/recurrent', label: 'Gérer mes abonnements' },
  });
}

async function answerBiggestExpense(question) {
  const period = extractPeriod(question);
  const rows = await repo.listTransactions({ from: period.from, to: period.to, limit: 2000 });
  const expenses = rows.filter((tx) => tx.status === 'active' && tx.amount < 0)
    .sort((a, b) => a.amount - b.amount);

  if (!expenses.length) {
    return answer({ intent: 'biggest_expense', text: `Aucune dépense ${period.label}.` });
  }

  const biggest = expenses[0];
  return answer({
    intent: 'biggest_expense',
    text: `Votre plus grosse dépense ${period.label} est ${money(Math.abs(biggest.amount))} chez ${biggest.merchant || biggest.raw_label}.`,
    evidence: expenses.slice(0, 5).map((tx) => ({
      label: `${tx.emoji || ''} ${tx.merchant || tx.raw_label} · ${fmtDay(tx.booked_at)}`,
      value: money(Math.abs(tx.amount)),
    })),
    action: { kind: 'navigate', path: '/banque', label: 'Voir toutes mes dépenses' },
  });
}

async function answerScenario(question, holdings) {
  const target = extractAmount(question);
  const symbol = extractSymbol(question, ['BTC', 'ETH', 'SOL']) || 'BTC';

  if (!target) {
    return answer({
      intent: 'scenario',
      text: "Précisez un prix, par exemple « que vaut mon portefeuille si BTC atteint 200 000 € ? ».",
    });
  }

  const reference = holdings.find((hold) => hold.symbol === symbol);
  const projection = projectPortfolio({
    holdings: holdings.map((hold) => ({ symbol: hold.symbol, quantity: hold.quantity, price: hold.price })),
    priceOverrides: { [symbol]: target, __btcCurrent: reference?.price },
  });

  return answer({
    intent: 'scenario',
    text: `Si ${symbol} atteignait ${money(target)}, vos positions vaudraient environ ${money(projection.projected)}, contre ${money(projection.current)} aujourd'hui.`,
    evidence: [
      { label: 'Variation', value: `${money(projection.delta, { sign: true })} (${pct(projection.delta_pct)})` },
      ...projection.lines.slice(0, 4).map((line) => ({
        label: `${line.symbol} · ${line.basis}`,
        value: money(line.value_scenario),
      })),
    ],
    caveat: projection.untouched_share > 0
      ? `Ce n'est pas une prévision, mais un calcul sous une hypothèse unique : seul ${symbol} bouge. ${Math.round(projection.untouched_share)} % de vos positions sont laissées à leur valeur actuelle, faute d'hypothèse les concernant.`
      : "Ce n'est pas une prévision, mais un calcul sous une hypothèse que vous avez fixée.",
    action: { kind: 'navigate', path: '/opportunites', label: 'Explorer les scénarios' },
  });
}

async function answerRisk(holdings) {
  const nw = await repo.getNetWorth();
  if (!holdings.length || !nw.total) {
    return answer({
      intent: 'risk',
      text: "Je n'ai pas assez de positions pour analyser une concentration.",
    });
  }

  const sorted = holdings.slice().sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const biggest = sorted[0];
  const shareBiggest = (biggest.value / nw.total) * 100;
  const cryptoShare = (nw.crypto / nw.total) * 100;

  const risks = [];
  if (shareBiggest > 40) {
    risks.push(`${biggest.symbol} représente ${Math.round(shareBiggest)} % de votre patrimoine`);
  }
  if (cryptoShare > 60) {
    risks.push(`la crypto pèse ${Math.round(cryptoShare)} % du total, une classe d'actifs très volatile`);
  }
  if (nw.cash < 1000) {
    risks.push('vos liquidités disponibles sont faibles pour absorber un imprévu');
  }

  return answer({
    intent: 'risk',
    text: risks.length
      ? `Votre principal risque est la concentration : ${risks[0]}.`
      : 'Votre répartition ne présente pas de concentration marquée.',
    evidence: [
      { label: `Poids de ${biggest.symbol}`, value: `${Math.round(shareBiggest)} %` },
      { label: 'Part crypto', value: `${Math.round(cryptoShare)} %` },
      { label: 'Liquidités', value: money(nw.cash) },
      ...risks.slice(1).map((r) => ({ label: 'Aussi', value: r })),
    ],
    caveat: 'Ceci décrit la composition de votre patrimoine. Ce n’est ni un conseil ni une recommandation d’allocation.',
    action: { kind: 'navigate', path: '/portefeuille', label: 'Voir la répartition' },
  });
}

async function answerScore(symbol) {
  const assets = await repo.listAssets();
  const asset = assets.find((a) => a.symbol === symbol) || assets[0];
  if (!asset) return answer({ intent: 'score', text: "Aucun actif suivi pour l'instant." });

  const [history, indicators, model] = await Promise.all([
    repo.getPriceHistory(asset.id, 1500),
    repo.getMarketIndicators().catch(() => ({})),
    repo.getScoreModel(),
  ]);

  const computed = computeIndicators(history);
  if (!computed.available) {
    return answer({ intent: 'score', text: `Pas encore assez d'historique sur ${asset.symbol} pour calculer un score.` });
  }

  const result = computeInvestmentScore({
    cyclePosition: computed.cycle?.value,
    mayer: computed.mayer?.value,
    momentum90: computed.momentum?.value_90d,
    mvrvProxy: computed.mvrv_proxy?.value,
    fearGreed: indicators.fear_greed?.value ?? null,
    drawdownPct: computed.drawdown?.value,
    volatility: computed.volatility?.value,
    macro: null,
  }, model);

  const zone = ZONE_META[result.zone];

  return answer({
    intent: 'score',
    text: `Le score de ${asset.symbol} est de ${result.score}/100 — ${zone?.label.toLowerCase() ?? 'zone inconnue'}. ${result.explanation}`,
    evidence: result.factors.filter((f) => f.available).slice(0, 4)
      .map((f) => ({ label: `${f.label} (poids ${f.weight})`, value: `${f.value}/100` })),
    caveat: `Ce score résume l'état actuel du marché selon VOS pondérations. Ce n'est pas une prévision, et ${Math.round(result.confidence * 100)} % des facteurs seulement sont renseignés.`,
    action: { kind: 'navigate', path: '/opportunites', label: 'Voir les zones' },
  });
}
