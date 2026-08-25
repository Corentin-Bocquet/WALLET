/**
 * WALLET · Opportunités — « Où sont les zones intéressantes ? » (§41)
 *
 * Trois blocs : les zones actuelles, les scénarios de prix, le backtest.
 * Chaque chiffre projeté sort avec sa fourchette et son hypothèse (§48).
 */

import { h, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { openSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import {
  screenHead, section, loadingRows, loadingBlock, emptyState, errorState,
  badge, estimateBadge, accordion, seeAll,
} from '../components/ui.js';
import { explainChip, labelWithInfo } from '../components/explain.js';
import { zoneBar, areaChart } from '../components/chart.js';
import { money, pct, num, range, day as fmtDay, trendClass } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { computeIndicators } from '../engine/indicators.js';
import { computeInvestmentScore, ZONE_META } from '../engine/score.js';
import { projectFromMa200w, projectAltFromBtc, projectionRange } from '../engine/scenarios.js';
import { compareStrategies } from '../engine/backtest.js';
import { showScoreReasoning } from './markets.js';

export async function opportunitiesScreen() {
  const screen = h('main.screen');
  screen.append(screenHead('Opportunités', {
    subtitle: 'Ce que disent les données aujourd’hui — pas ce qui va se passer',
  }));

  const zones = h('div');
  screen.append(section('Zones actuelles', { explain: 'investment_score' }, zones));
  mount(zones, loadingRows(4));

  const scenarios = h('div');
  screen.append(section('Scénarios Bitcoin', {
    action: h('button.btn.btn--ghost.btn--sm', {
      type: 'button', 'data-sound': 'sheetOpen', onclick: () => editScenarios(),
    }, 'Modifier'),
  }, scenarios));
  mount(scenarios, loadingBlock(180));

  const alts = h('div');
  screen.append(section('Projection ALT / BTC', { explain: 'alt_btc_ratio' }, alts));
  mount(alts, loadingBlock(140));

  const backtest = h('div');
  screen.append(section('Et si j’avais…', { explain: 'dca' }, backtest));
  mount(backtest, loadingBlock(160));

  renderAll({ zones, scenarios, alts, backtest });
  return screen;
}

async function renderAll(hosts) {
  let assets = [];
  let model = null;

  try {
    [assets, model] = await Promise.all([repo.listAssets(), repo.getScoreModel()]);
  } catch (error) {
    mount(hosts.zones, errorState(error, { what: 'les marchés' }));
    return;
  }

  const market = await repo.getMarketIndicators().catch(() => ({}));

  /* — 1. Zones : score de chaque actif suivi ————————— */
  const watch = await repo.getWatchlist().catch(() => []);
  const candidates = (watch.length ? watch : assets.slice(0, 6));

  const scored = [];
  for (const asset of candidates) {
    try {
      const history = await repo.getPriceHistory(asset.id, 1500);
      const computed = computeIndicators(history);
      if (!computed.available) continue;

      const result = computeInvestmentScore({
        cyclePosition: computed.cycle?.value,
        mayer: computed.mayer?.value,
        momentum90: computed.momentum?.value_90d,
        mvrvProxy: computed.mvrv_proxy?.value,
        fearGreed: market.fear_greed ? Number(market.fear_greed.value) : null,
        drawdownPct: computed.drawdown?.value,
        volatility: computed.volatility?.value,
        macro: null,
      }, model);

      scored.push({ asset, result, computed });
    } catch { /* un actif en échec ne doit pas vider l'écran */ }
  }

  scored.sort((a, b) => (b.result.score ?? -1) - (a.result.score ?? -1));

  if (!scored.length) {
    mount(hosts.zones, emptyState({
      emoji: '📉', title: 'Pas assez d’historique',
      body: 'Les zones apparaîtront une fois les prix historiques synchronisés.',
    }));
  } else {
    mount(hosts.zones, h('div',
      h('div.rows', scored.map(({ asset, result }) => {
        const zone = ZONE_META[result.zone] || {};
        return h('button.row', {
          type: 'button', 'data-sound': 'sheetOpen',
          onclick: () => showScoreReasoning(asset, result),
        },
          h('div.avatar', { style: { background: 'var(--surface-2)', fontWeight: '700', fontSize: '13px' } },
            asset.symbol.slice(0, 3)),
          h('div.row__main',
            h('div.row__title', asset.name),
            h('div.row__sub', `${zone.emoji ?? ''} ${zone.label ?? 'zone inconnue'}`),
          ),
          h('div.row__end',
            h('div.row__value', { style: { color: zone.color } },
              result.score === null ? '—' : `${result.score}`),
            h('div.row__sub', result.confidence < 0.75
              ? `${Math.round(result.confidence * 100)} % de facteurs`
              : '/100'),
          ),
        );
      })),
      h('div', { style: { marginTop: '20px' } }, zoneLegend(model)),
    ));
  }

  /* — 2. Scénarios Bitcoin ————————————————————————— */
  const btc = assets.find((a) => a.symbol === 'BTC');
  if (!btc) {
    mount(hosts.scenarios, emptyState({ emoji: '₿', title: 'Bitcoin n’est pas suivi' }));
  } else {
    await renderScenarios(hosts.scenarios, btc);
    await renderAlts(hosts.alts, btc, assets);
    await renderBacktest(hosts.backtest, btc, model);
  }
}

function zoneLegend(model) {
  const thresholds = model?.zone_thresholds || {};
  return h('div.card',
    h('div.eyebrow', 'Comment lire ces zones'),
    h('div', { style: { marginTop: '14px' } }, zoneBar(null, thresholds)),
    h('div.rows', { style: { marginTop: '12px' } },
      Object.entries(ZONE_META).reverse().map(([key, meta]) => h('div.row', {
        style: { gridTemplateColumns: 'auto 1fr auto', minHeight: '44px' },
      },
        h('div.avatar.avatar--dot', { style: { background: meta.color } }),
        h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, `${meta.emoji} ${meta.label}`)),
        h('div.row__end', h('div.row__sub',
          key === 'distribution' ? `< ${thresholds.expensive ?? 30}` : `≥ ${thresholds[key] ?? ''}`)),
      ))),
    h('p.explain__source', { style: { marginTop: '12px' } },
      'Ces seuils sont les vôtres : modifiez-les dans Profil → Paramètres du moteur.'),
  );
}

async function renderScenarios(host, btc) {
  try {
    const [history, scenarios] = await Promise.all([
      repo.getPriceHistory(btc.id, 1500),
      repo.listScenarios(btc.id),
    ]);

    const computed = computeIndicators(history);
    const ma200w = computed.ma200w?.reference ?? null;
    const projection = projectFromMa200w(ma200w, scenarios);

    if (!projection.available) {
      mount(host, h('div.notice',
        h('span', 'ℹ️'),
        h('div', h('strong', 'Projection indisponible'), projection.reason)));
      return;
    }

    const current = btc.quote?.price ?? computed.price;

    mount(host, h('div.card',
      h('div.eyebrow', 'Prix potentiel du Bitcoin', explainChip('cycle_position', { label: 'cycle' })),

      // Jamais un chiffre seul : la fourchette d'abord, le central ensuite (§48).
      h('div.display.num', { style: { marginTop: '8px', fontSize: '30px' } },
        range(projection.low, projection.high)),
      h('div.muted', { style: { marginTop: '6px' } },
        'Scénario central : ',
        h('strong', { style: { color: 'var(--text)' } }, money(projection.central, { compact: true, decimals: 0 })),
        projection.expected ? ` · espérance pondérée ${money(projection.expected, { compact: true, decimals: 0 })}` : null,
      ),

      h('div.rows', { style: { marginTop: '20px' } },
        projection.projections.map((p) => h('div.row', { style: { gridTemplateColumns: 'auto 1fr auto' } },
          h('div.avatar.avatar--dot', {
            style: { background: ({ bear: 'var(--down)', base: 'var(--zone-neutral)', bull: 'var(--up)' })[p.kind] ?? 'var(--neutral)' },
          }),
          h('div.row__main',
            h('div.row__title', p.name),
            h('div.row__sub', { style: { whiteSpace: 'normal' } }, p.assumption),
          ),
          h('div.row__end',
            h('div.row__value', money(p.target, { compact: true, decimals: 0 })),
            h('div.row__sub', current ? `${(p.target / current).toFixed(1)}× le prix actuel` : null),
          ),
        ))),

      h('div.notice', { style: { marginTop: '18px' } },
        h('span', '📐'),
        h('div',
          h('strong', 'Comment c’est calculé'),
          `Base : ${money(projection.basis, { decimals: 0 })}, la ${projection.basis_label}. Chaque scénario applique un multiple que vous fixez. ${projection.disclaimer}`)),
    ));
  } catch (error) {
    mount(host, errorState(error, { what: 'les scénarios' }));
  }
}

async function renderAlts(host, btc, assets) {
  try {
    const alts = assets.filter((a) => a.symbol !== 'BTC').slice(0, 6);
    if (!alts.length) { mount(host, h('div')); return; }

    const scenarios = await repo.listScenarios(btc.id);
    const history = await repo.getPriceHistory(btc.id, 1500);
    const computed = computeIndicators(history);
    const projection = projectFromMa200w(computed.ma200w?.reference, scenarios);
    const defaultBtcTarget = projection.available ? projection.central : (btc.quote?.price ?? null);

    let btcTarget = defaultBtcTarget;
    const container = h('div');

    const paint = async () => {
      const rows = [];
      for (const alt of alts) {
        const ratios = await repo.listAltRatios(alt.id).catch(() => []);
        const result = projectAltFromBtc({
          btcPrice: btcTarget,
          ratios,
          currentAltPrice: alt.quote?.price ?? null,
        });
        if (!result.available) continue;
        rows.push({ alt, result });
      }

      mount(container,
        h('div.card',
          h('div.eyebrow', 'Si le Bitcoin atteignait'),
          h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' } },
            h('input', {
              type: 'number', step: '1000', value: Math.round(btcTarget ?? 0),
              inputmode: 'numeric', 'aria-label': 'Prix Bitcoin hypothétique',
              style: { background: 'var(--surface-2)', borderRadius: 'var(--r-md)',
                padding: '12px 14px', flex: '1', fontWeight: '700', fontSize: '20px' },
              onchange: (event) => { btcTarget = Number(event.target.value) || btcTarget; paint(); },
            }),
            h('span.muted', '€'),
          ),

          h('div.rows', { style: { marginTop: '16px' } },
            rows.map(({ alt, result }) => h('div.row',
              h('div.avatar', { style: { background: 'var(--surface-2)', fontWeight: '700', fontSize: '12px' } },
                alt.symbol.slice(0, 3)),
              h('div.row__main',
                h('div.row__title', alt.symbol),
                h('div.row__sub', `Prix actuel ${money(alt.quote?.price)}`),
              ),
              h('div.row__end',
                h('div.row__value', range(result.low, result.high, { decimals: undefined })),
                h('div.row__sub', alt.quote?.price
                  ? `${(result.central / alt.quote.price).toFixed(1)}× médian` : null),
              ),
            ))),

          rows.length
            ? h('div.notice.notice--warn', { style: { marginTop: '16px' } },
                h('span', '⚠️'),
                h('div',
                  h('strong', 'Ce que ce calcul ne dit pas'),
                  h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } },
                    rows[0].result.caveats.map((c) => h('li', { style: { marginTop: '4px' } }, c)))))
            : null,
        ),
      );
    };

    await paint();
    mount(host, container);
  } catch (error) {
    mount(host, errorState(error, { what: 'les projections ALT' }));
  }
}

async function renderBacktest(host, btc, model) {
  try {
    const history = await repo.getPriceHistory(btc.id, 1500);
    const comparison = compareStrategies(history, { amount: 100, cadence: 'monthly', model });

    if (!comparison.runs.length) {
      mount(host, h('div.notice', h('span', 'ℹ️'),
        h('div', h('strong', 'Simulation impossible'), 'Historique de prix trop court.')));
      return;
    }

    mount(host, h('div.card',
      h('div.eyebrow', '100 € investis chaque mois depuis le début de l’historique'),

      h('div.rows', { style: { marginTop: '16px' } },
        comparison.runs.map(({ key, label, result }) => h('div.row',
          h('div.avatar.avatar--dot', {
            style: { background: key === comparison.best ? 'var(--accent)' : 'var(--surface-3)' },
          }),
          h('div.row__main',
            h('div.row__title', label, key === comparison.best ? badge('meilleur', 'accent') : null),
            h('div.row__sub', `${result.trades} achats · ${money(result.invested, { decimals: 0 })} investis`),
          ),
          h('div.row__end',
            h('div.row__value.sensitive', money(result.final_value, { decimals: 0 })),
            h('div.row__sub', { class: trendClass(result.roi_pct) }, pct(result.roi_pct)),
          ),
        ))),

      accordion('Voir le détail des simulations', () => h('div.rows',
        comparison.runs.map(({ label, result }) => h('div', { style: { paddingBlock: '12px' } },
          h('div', { style: { fontWeight: '600', marginBottom: '8px' } }, label),
          detailLine('Période', `${fmtDay(result.period_start)} → ${fmtDay(result.period_end)}`),
          detailLine('Prix de revient moyen', money(result.average_cost)),
          detailLine('Rendement annualisé', pct(result.annualized_pct)),
          detailLine('Pire baisse traversée', pct(result.max_drawdown_pct)),
          result.skipped ? detailLine('Périodes écartées par le score', String(result.skipped)) : null,
        )))),

      h('div.notice', { style: { marginTop: '16px' } },
        h('span', '🔒'),
        h('div',
          h('strong', 'Aucune donnée future n’est utilisée'),
          'Chaque décision de la simulation est prise avec les seules données disponibles à sa date. C’est vérifié par un test automatique qui injecte une valeur aberrante dans le futur : le résultat ne bouge pas.')),

      h('p.explain__source', { style: { marginTop: '12px' } }, comparison.note),
    ));
  } catch (error) {
    mount(host, errorState(error, { what: 'la simulation' }));
  }
}

function detailLine(label, value) {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between', paddingBlock: '5px' } },
    h('span.muted', { style: { fontSize: 'var(--fs-sm)' } }, label),
    h('span.num', { style: { fontSize: 'var(--fs-sm)', fontWeight: '600' } }, value),
  );
}

/* — Édition des scénarios (§29 : tout doit être modifiable) ————— */

async function editScenarios() {
  const assets = await repo.listAssets();
  const btc = assets.find((a) => a.symbol === 'BTC');
  if (!btc) return;

  const scenarios = await repo.listScenarios(btc.id);

  openSheet({
    title: 'Mes scénarios Bitcoin',
    build: ({ close }) => {
      const inputs = scenarios.map((scenario) => {
        const multiple = h('input', {
          type: 'number', step: '0.1', inputmode: 'decimal',
          value: scenario.assumptions?.multiple_of_200w_ma ?? 1,
        });
        const probability = h('input', {
          type: 'number', step: '5', min: '0', max: '100', inputmode: 'numeric',
          value: Math.round((scenario.probability ?? 0) * 100),
        });
        const note = h('input', { type: 'text', value: scenario.assumptions?.note ?? '' });
        return { scenario, multiple, probability, note };
      });

      const error = h('div.field__error');

      return h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          const total = inputs.reduce((a, i) => a + Number(i.probability.value), 0);
          if (Math.abs(total - 100) > 0.5) {
            error.textContent = `Les probabilités font ${total} %. Elles doivent totaliser 100 %.`;
            return;
          }
          await repo.saveScenarios(btc.id, inputs.map(({ scenario, multiple, probability, note }) => ({
            ...scenario,
            probability: Number(probability.value) / 100,
            assumptions: {
              ...scenario.assumptions,
              multiple_of_200w_ma: Number(multiple.value),
              note: note.value,
            },
          })));
          close();
          toast('Scénarios enregistrés', { kind: 'success' });
          setTimeout(() => window.location.reload(), 400);
        },
      },
        h('p.muted', { style: { fontSize: 'var(--fs-sm)' } },
          'Chaque scénario multiplie la moyenne 200 semaines. C’est votre hypothèse, pas celle de WALLET.'),

        inputs.map(({ scenario, multiple, probability, note }) => h('div', {
          style: { marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--hairline)' },
        },
          h('div', { style: { fontWeight: '700', marginBottom: '12px' } }, scenario.name),
          h('div.field', h('label', 'Multiple de la moyenne 200 semaines'), multiple),
          h('div.field', h('label', 'Probabilité (%)'), probability),
          h('div.field', h('label', 'Hypothèse'), note),
        )),

        error,
        h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select',
          style: { marginTop: '20px' } }, 'Enregistrer'),
      );
    },
  });
}
