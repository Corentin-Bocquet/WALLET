/**
 * WALLET · Accueil — « Comment va mon patrimoine ? » (§41)
 *
 * Règle des 3 secondes (§40) : en arrivant, on doit voir un seul grand
 * chiffre, savoir s'il monte ou descend, et rien d'autre. Tout le reste est
 * accessible d'un tap, jamais affiché d'office.
 */

import { h, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { openSheet } from '../lib/sheet.js';
import {
  screenHead, section, bigAmount, freshness, partialNotice, loadingBlock,
  loadingRows, emptyState, asyncBlock, seeAll, demoBanner, badge,
} from '../components/ui.js';
import { explainChip, labelWithInfo } from '../components/explain.js';
import { areaChart, barList } from '../components/chart.js';
import { money, pct, day as fmtDay, trendClass } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { openAssistant } from './assistant.js';

const RANGES = [
  { key: 30, label: '1 mois' },
  { key: 90, label: '3 mois' },
  { key: 365, label: '1 an' },
];

export async function homeScreen() {
  const screen = h('main.screen', { id: 'ecran-accueil' });

  screen.append(
    screenHead('Accueil', {
      right: h('button.icon-btn', {
        type: 'button', 'aria-label': 'Demander à mon patrimoine',
        'data-sound': 'sheetOpen', onclick: () => openAssistant(),
      }, '💬'),
    }),
  );

  if (repo.isDemoMode()) screen.append(demoBanner());

  /* — 1. Le chiffre —————————————————————————————————— */
  const hero = h('div');
  screen.append(hero);
  mount(hero, loadingBlock(190));
  renderHero(hero);

  /* — 2. Le mois en cours ————————————————————————— */
  screen.append(section('Ce mois-ci', {
    action: seeAll('Détail', () => navigate('/banque')),
  }, asyncBlock(loadMonth(), {
    loading: () => loadingBlock(120),
    render: renderMonth,
    what: 'votre mois',
  })));

  /* — 3. Où part l'argent ————————————————————————— */
  screen.append(section('Où part l’argent', {
    action: seeAll('Tout voir', () => navigate('/banque')),
  }, asyncBlock(repo.categoryBreakdown(), {
    loading: () => loadingRows(4),
    render: (rows) => barList(rows.slice(0, 5), {
      onSelect: (item) => navigate(`/banque?categorie=${item.category_id ?? ''}`),
    }),
    empty: () => emptyState({
      emoji: '🧾',
      title: 'Aucune dépense ce mois-ci',
      body: 'Importez un relevé depuis Profil → Comptes pour commencer.',
    }),
    what: 'la répartition',
  })));

  /* — 4. Ce que WALLET a remarqué ————————————————— */
  const insights = h('div');
  screen.append(section('Ce que WALLET a remarqué', {}, insights));
  mount(insights, loadingRows(2));
  renderInsights(insights);

  return screen;
}

/* ------------------------------------------------------------------ */
/* Le grand montant et sa courbe                                       */
/* ------------------------------------------------------------------ */

async function renderHero(host) {
  const [netWorth, sync] = await Promise.all([
    repo.getNetWorth().catch((e) => ({ error: e })),
    repo.getSyncState().catch(() => ({})),
  ]);

  if (netWorth.error) {
    mount(host, h('div.notice.notice--danger',
      h('span', '⚠️'),
      h('div', h('strong', 'Patrimoine indisponible'),
        'Impossible de calculer votre patrimoine pour le moment.')));
    return;
  }

  const container = h('div');
  let days = 30;

  const paint = () => {
    const series = (netWorth.series || []).slice(-days);
    const first = series.length ? Number(series[0].total_value ?? series[0].total) : null;
    const change = first !== null ? netWorth.total - first : null;
    const changePct = first ? ((netWorth.total / first) - 1) * 100 : null;

    mount(container,
      bigAmount(netWorth.total, {
        label: 'Patrimoine total',
        explain: 'net_worth',
        change,
        changePct,
        changeLabel: RANGES.find((r) => r.key === days)?.label,
      }),

      h('div', { style: { marginTop: '10px' } },
        freshness(sync.market?.last_success, {
          status: sync.market?.status,
          message: sync.market?.message,
          thresholdSeconds: 3600,
        }),
      ),

      netWorth.is_partial ? h('div', { style: { marginTop: '14px' } },
        partialNotice(netWorth.unknown, { onFix: () => navigate('/profil/comptes') })) : null,

      h('div', { style: { marginTop: '20px' } },
        series.length > 2
          ? areaChart(series.map((s) => ({ day: s.day, value: Number(s.total_value ?? s.total) })),
              { height: 150 })
          : h('p.muted-2', { style: { fontSize: 'var(--fs-sm)' } },
              'La courbe apparaîtra après quelques jours de suivi.'),
      ),

      h('div.segmented', { style: { marginTop: '14px' } },
        RANGES.map((range) => h('button', {
          type: 'button',
          'aria-selected': String(range.key === days),
          'data-sound': 'select',
          onclick: () => { days = range.key; paint(); },
        }, range.label)),
      ),

      // Décomposition : trois tuiles, pas un tableau (§5)
      h('div.hscroll', { style: { marginTop: '20px' } },
        splitTile('Crypto', netWorth.crypto, '₿', () => navigate('/portefeuille')),
        splitTile('Liquidités', netWorth.cash, '💶', () => navigate('/portefeuille')),
        netWorth.equity > 0 ? splitTile('Actions', netWorth.equity, '📈', () => navigate('/portefeuille')) : null,
      ),
    );
  };

  paint();
  mount(host, container);
}

function splitTile(label, value, emoji, onClick) {
  return h('button.tile.card--tap', {
    type: 'button', 'data-sound': 'select', onclick: onClick,
    style: { minWidth: '132px' },
  },
    h('div.tile__label', label),
    h('div', { style: { fontSize: '22px' } }, emoji),
    h('div.tile__value.sensitive', money(value, { compact: true, decimals: 0 })),
  );
}

/* ------------------------------------------------------------------ */
/* Le mois                                                             */
/* ------------------------------------------------------------------ */

async function loadMonth() {
  const now = new Date();
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
  const [current, previous] = await Promise.all([
    repo.monthlySummary(),
    repo.monthlySummary(previousMonth),
  ]);
  return { current, previous };
}

function renderMonth({ current, previous }) {
  if (!current) return emptyState({ emoji: '🧾', title: 'Aucune donnée bancaire' });

  const expense = Number(current.expense);
  const income = Number(current.income);
  const invested = Number(current.invested ?? 0);
  const rate = current.savings_rate === null ? null : Number(current.savings_rate);
  const previousExpense = previous ? Number(previous.expense) : null;
  const expenseChange = previousExpense ? ((expense / previousExpense) - 1) * 100 : null;

  return h('div.card',
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' } },
      h('div',
        h('div.eyebrow', '💳 Dépenses'),
        h('div.num.sensitive', { style: { fontSize: '28px', fontWeight: '700', marginTop: '4px' } },
          money(expense, { decimals: 0 })),
        Number.isFinite(expenseChange)
          ? h('div.num', { class: trendClass(-expenseChange), style: { fontSize: 'var(--fs-sm)', fontWeight: '600' } },
              `${pct(expenseChange)} vs mois dernier`)
          : h('div.muted-2', { style: { fontSize: 'var(--fs-sm)' } }, 'Pas de mois précédent à comparer'),
      ),
      h('div', { style: { textAlign: 'right' } },
        h('div.eyebrow', { style: { justifyContent: 'flex-end' } },
          'Épargne', explainChip('savings_rate', { label: "taux d'épargne" })),
        h('div.num.sensitive', { style: { fontSize: '28px', fontWeight: '700', marginTop: '4px' } },
          rate === null
            ? h('span.unknown', '—')
            : `${Math.round(rate)} %`),
        h('div.muted', { style: { fontSize: 'var(--fs-sm)' } },
          rate === null
            ? 'revenus inconnus'
            : money(Number(current.net_savings), { decimals: 0 })),
      ),
    ),

    invested > 0 ? h('div', {
      style: { marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--hairline)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    },
      h('span.muted', { style: { fontSize: 'var(--fs-sm)' } }, '📊 Investi ce mois-ci'),
      h('span.num.sensitive', { style: { fontWeight: '600' } }, money(invested, { decimals: 0 })),
    ) : null,

    // Barre revenus / dépenses : une seule image vaut mieux que deux chiffres.
    income > 0 ? h('div', { style: { marginTop: '18px' } },
      h('div.meter', { style: { height: '8px' } },
        h('div.meter__fill', {
          style: {
            width: `${Math.min(100, (expense / income) * 100)}%`,
            background: expense > income ? 'var(--down)' : 'var(--accent)',
          },
        })),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '8px' } },
        h('span.muted', { style: { fontSize: 'var(--fs-xs)' } },
          `Dépensé ${money(expense, { decimals: 0 })}`),
        h('span.muted', { style: { fontSize: 'var(--fs-xs)' } },
          `Reçu ${money(income, { decimals: 0 })}`),
      ),
    ) : null,
  );
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

async function renderInsights(host) {
  const [insights, anomalies, recurring] = await Promise.all([
    repo.listInsights().catch(() => []),
    repo.listAnomalies().catch(() => []),
    repo.listRecurring().catch(() => []),
  ]);

  const cards = [];

  for (const insight of insights.slice(0, 3)) {
    cards.push(insightCard(insight));
  }

  if (!insights.some((i) => i.code === 'anomaly') && anomalies.length) {
    cards.push(insightCard({
      id: 'anomaly-derived', code: 'anomaly', severity: 'warning',
      title: 'Dépense inhabituelle', body: anomalies[0].explanation,
      evidence: anomalies[0],
    }));
  }

  const activeSubs = recurring.filter((r) => r.is_active && r.direction === 'debit');
  if (activeSubs.length) {
    const monthlyCost = activeSubs.reduce((total, r) => {
      const perMonth = { weekly: 30.44 / 7, biweekly: 30.44 / 14, monthly: 1,
        bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12 }[r.cadence] ?? 0;
      return total + Number(r.average_amount) * perMonth;
    }, 0);

    cards.push(h('button.card.card--tap', {
      type: 'button', 'data-sound': 'select',
      style: { textAlign: 'left', width: '100%' },
      onclick: () => navigate('/banque/recurrent'),
    },
      h('div.eyebrow', '🔄 Paiements récurrents'),
      h('div', { style: { marginTop: '6px' } },
        h('span.num.sensitive', { style: { fontSize: '22px', fontWeight: '700' } },
          money(monthlyCost, { decimals: 0 })),
        h('span.muted', ' par mois'),
      ),
      h('div.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '4px' } },
        `${activeSubs.length} prélèvements réguliers détectés`),
    ));
  }

  if (!cards.length) {
    mount(host, emptyState({
      emoji: '✅',
      title: 'Rien à signaler',
      body: 'Aucune dépense inhabituelle ni dérive détectée sur la période.',
    }));
    return;
  }

  mount(host, h('div', { style: { display: 'grid', gap: '12px' } }, cards));
}

function insightCard(insight) {
  const tone = { warning: '⚠️', danger: '🔴', success: '✅', info: '💡' }[insight.severity] || '💡';

  return h('button.card.card--tap', {
    type: 'button', 'data-sound': 'sheetOpen',
    style: { textAlign: 'left', width: '100%' },
    onclick: () => showInsight(insight),
  },
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
      h('span', { style: { fontSize: '20px' } }, tone),
      h('div', { style: { minWidth: 0 } },
        h('div', { style: { fontWeight: '600' } }, insight.title),
        h('div.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '2px' } }, insight.body),
      ),
    ),
  );
}

function showInsight(insight) {
  openSheet({
    title: insight.title,
    build: ({ close }) => h('div',
      h('p', insight.body),

      insight.code === 'anomaly' && insight.evidence
        ? h('div', { style: { marginTop: '20px' } },
            labelWithInfo('Comment WALLET a décidé', 'anomaly', 'div'),
            h('div.rows', { style: { marginTop: '12px' } },
              evidenceRow('Montant', money(insight.evidence.amount)),
              evidenceRow('Habitude', money(insight.evidence.median)),
              evidenceRow('Rapport', `${insight.evidence.ratio}×`),
              evidenceRow('Comparé à',
                insight.evidence.basis === 'merchant'
                  ? 'vos autres passages chez ce marchand'
                  : 'votre habitude dans cette catégorie'),
              evidenceRow('Observations', `${insight.evidence.sample_size}`),
            ),
          )
        : null,

      insight.code === 'to_classify'
        ? h('button.btn.btn--primary.btn--block', {
            type: 'button', 'data-sound': 'select',
            style: { marginTop: '24px' },
            onclick: () => { close(); navigate('/banque/a-classer'); },
          }, 'Classer maintenant')
        : null,

      h('button.btn.btn--ghost.btn--block', {
        type: 'button', style: { marginTop: '12px' },
        onclick: async () => { await repo.dismissInsight(insight.id).catch(() => {}); close(); },
      }, 'Ne plus afficher'),
    ),
  });
}

function evidenceRow(label, value) {
  return h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, label)),
    h('div.row__end', h('div.row__value', value)),
  );
}
