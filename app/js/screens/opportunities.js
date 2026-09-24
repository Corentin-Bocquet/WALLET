/**
 * WALLET · Opportunités — « Où sont les zones intéressantes ? » (§41)
 *
 * Trois blocs : les zones actuelles, les scénarios de prix, le backtest.
 * Chaque chiffre projeté sort avec sa fourchette et son hypothèse (§48).
 */

import { h, mount } from '../lib/dom.js';
import { glyph } from '../components/icons.js';
import { navigate, refresh } from '../lib/router.js';
import { openSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import {
  screenHead, section, loadingRows, loadingBlock, emptyState, errorState,
  badge, estimateBadge, accordion, seeAll, subNav, MARKETS_NAV, currencyToggle, zoneTag,
} from '../components/ui.js';
import { explainChip, labelWithInfo } from '../components/explain.js';
import { zoneBar, areaChart } from '../components/chart.js';
import { money, pct, num, range, day as fmtDay, trendClass, score as fmtScore } from '../lib/fmt.js';
import { assetAvatar } from '../components/brand.js';
import * as repo from '../data/repo.js';
import { computeIndicators } from '../engine/indicators.js';
import { computeInvestmentScore, ZONE_META } from '../engine/score.js';
import { projectFromMa200w, projectAltFromBtc, projectionRange } from '../engine/scenarios.js';
import { compareStrategies } from '../engine/backtest.js';
import { showScoreReasoning } from './markets.js';

export async function opportunitiesScreen() {
  const screen = h('main.screen');
  screen.append(screenHead('Marchés', { right: currencyToggle() }));
  screen.append(subNav(MARKETS_NAV, '/opportunites'));
  screen.append(h('p.muted', { style: { fontSize: 'var(--fs-sm)', margin: '-6px 0 8px' } },
    'Ce que disent les données aujourd’hui, pas ce qui va se passer.'));

  const zones = h('div');
  screen.append(section('Zones actuelles', {
    explain: 'investment_score',
    // Les zones portent sur VOTRE liste : on y ajoute ou retire des cryptos.
    action: h('button.btn.btn--ghost.btn--sm', {
      type: 'button', 'data-sound': 'sheetOpen', onclick: () => pickCryptos(),
    }, '+ Cryptos'),
  }, zones));
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
  mount(backtest, loadingBlock(220));

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
      emoji: glyph('trendDown'), title: 'Pas assez d’historique',
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
          assetAvatar(asset),
          h('div.row__main',
            h('div.row__title', asset.name),
            h('div.row__sub', zoneTag(zone)),
          ),
          h('div.row__end',
            // La note en grand, en gras, sur une pastille teintée de la
            // couleur de sa zone : lisible même quand la zone est jaune.
            h('span.score-pill.num', { style: { '--zone': zone.color ?? 'var(--neutral)' } },
              result.score === null ? '—' : fmtScore(result.score),
              h('small', '/100')),
            result.confidence < 0.75
              ? h('div.row__sub', `${Math.round(result.confidence * 100)} % de facteurs`)
              : null,
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
    await renderSimulator(hosts.backtest, btc, assets, model);
  }
}

function zoneLegend(model) {
  const thresholds = model?.zone_thresholds || {};
  // Repliée par défaut : la légende sert une fois, elle n'a pas à occuper
  // un écran entier à chaque visite.
  return accordion('Comment lire ces zones', () => h('div',
    h('div', { style: { marginTop: '8px' } }, zoneBar(null, thresholds)),
    h('div.rows', { style: { marginTop: '12px' } },
      Object.entries(ZONE_META).reverse().map(([key, meta]) => h('div.row', {
        style: { gridTemplateColumns: 'auto 1fr auto', minHeight: '44px' },
      },
        h('div.avatar.avatar--dot', { style: { background: meta.color } }),
        h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, meta.label)),
        h('div.row__end', h('div.row__sub',
          key === 'distribution' ? `< ${thresholds.expensive ?? 30}` : `≥ ${thresholds[key] ?? ''}`)),
      ))),
    h('p.explain__source', { style: { marginTop: '12px' } },
      'Ces seuils sont les vôtres : modifiez-les dans Profil → Paramètres du moteur.'),
  ));
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
        h('span', 'ℹ'),
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
        h('span', glyph('ruler')),
        h('div',
          h('strong', 'Comment c’est calculé'),
          `Base : ${money(projection.basis, { decimals: 0 })}, la ${projection.basis_label}. Chaque scénario applique un multiple que vous fixez. ${projection.disclaimer}`)),
    ));
  } catch (error) {
    mount(host, errorState(error, { what: 'les scénarios' }));
  }
}

/** Cryptos proposées en premier : celles que l'on détient, puis sa liste. */
async function preferredAlts(assets) {
  const [holdings, watch] = await Promise.all([
    repo.getHoldings().catch(() => []), repo.getWatchlist().catch(() => []),
  ]);
  const usable = assets.filter((a) => a.symbol !== 'BTC' && !repo.isStablecoin(a.symbol));
  const order = [...new Set([
    ...holdings.map((hold) => hold.asset_id), ...watch.map((w) => w.id), ...usable.map((a) => a.id),
  ])];
  return order.map((id) => usable.find((a) => a.id === id)).filter(Boolean);
}

async function renderAlts(host, btc, assets) {
  try {
    const alts = await preferredAlts(assets);
    if (!alts.length) { mount(host, emptyState({ emoji: glyph('coin'), title: 'Aucune autre crypto suivie' })); return; }

    const [scenarios, history, holdings] = await Promise.all([
      repo.listScenarios(btc.id), repo.getPriceHistory(btc.id, 1500), repo.getHoldings().catch(() => []),
    ]);
    const computed = computeIndicators(history);
    const projection = projectFromMa200w(computed.ma200w?.reference, scenarios);
    const btcNow = btc.quote?.price ?? computed.price ?? null;

    let btcTarget = projection.available ? projection.central : btcNow;
    let alt = alts[0];
    const container = h('div.card');

    // Raccourcis de prix : les scénarios et le prix actuel, en un tap.
    const presets = [
      ...(projection.available ? projection.projections.map((p) => ({ label: p.name, value: p.target })) : []),
      btcNow ? { label: 'Actuel', value: btcNow } : null,
    ].filter(Boolean);

    const paint = async () => {
      const ratios = await repo.listAltRatios(alt.id, btc.id).catch(() => []);
      const result = projectAltFromBtc({ btcPrice: btcTarget, ratios, currentAltPrice: alt.quote?.price ?? null });
      const held = holdings.filter((hold) => hold.asset_id === alt.id)
        .reduce((sum, hold) => sum + (Number(hold.quantity) || 0), 0);

      const input = h('input', {
        type: 'number', step: '1000', min: '0', value: Math.round(btcTarget ?? 0),
        inputmode: 'numeric', 'aria-label': 'Prix du Bitcoin', class: 'big-input',
        onchange: (event) => { btcTarget = Number(event.target.value) || btcTarget; paint(); },
      });

      mount(container,
        h('div.eyebrow', '1. Le Bitcoin atteint…'),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px' } },
          input, h('span.muted', { style: { fontWeight: '700' } }, '€')),
        h('div.chip-line', presets.map((p) => h('button.chip', {
          type: 'button', 'data-sound': 'select',
          'aria-pressed': String(Math.round(p.value) === Math.round(btcTarget ?? -1)),
          onclick: () => { btcTarget = p.value; paint(); },
        }, `${p.label} · ${money(p.value, { compact: true, decimals: 0 })}`))),

        h('div.eyebrow', { style: { marginTop: '20px' } }, '2. Pour quelle crypto ?'),
        h('div.chip-line', alts.slice(0, 8).map((a) => h('button.chip', {
          type: 'button', 'data-sound': 'select', 'aria-pressed': String(a.id === alt.id),
          onclick: () => { alt = a; paint(); },
        }, a.symbol))),
        alts.length > 8 ? h('select.chip-select', {
          'aria-label': 'Autre crypto',
          onchange: (event) => { alt = alts.find((a) => a.id === event.target.value) ?? alt; paint(); },
        }, h('option', { value: '' }, 'Autre crypto…'),
          alts.slice(8).map((a) => h('option', { value: a.id, selected: a.id === alt.id }, `${a.symbol} · ${a.name}`))) : null,

        h('div.result-block',
          result.available
            ? [
                h('div.eyebrow', `3. ${alt.symbol} vaudrait`),
                h('div.display.num', { style: { fontSize: '28px', marginTop: '4px' } },
                  range(result.low, result.high, { decimals: undefined })),
                h('div.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '4px' } },
                  `Prix actuel ${money(alt.quote?.price)}`,
                  alt.quote?.price ? ` · soit ${(result.central / alt.quote.price).toFixed(1)}× au ratio médian` : ''),
                h('div.rows', { style: { marginTop: '12px' } }, result.results.map((r) => h('div.row',
                  { style: { gridTemplateColumns: '1fr auto', minHeight: '46px' } },
                  h('div.row__main',
                    h('div.row__title', { style: { fontWeight: '500' } }, r.label),
                    h('div.row__sub', `ratio ${num(r.ratio, { decimals: 6 })} BTC`)),
                  h('div.row__end',
                    h('div.row__value', money(r.target)),
                    r.multiple_vs_now ? h('div.row__sub', `${r.multiple_vs_now}× aujourd’hui`) : null),
                ))),
                held > 0 ? h('div.notice', { style: { marginTop: '12px' } }, h('span', glyph('wallet')),
                  h('div', h('strong', `Vos ${num(held)} ${alt.symbol}`),
                    `vaudraient ${range(result.low * held, result.high * held)} (${money(result.central * held, { decimals: 0 })} au ratio médian).`)) : null,
                h('p.explain__source', { style: { marginTop: '12px' } },
                  'Prix = prix du Bitcoin × ratio ' + alt.symbol + '/BTC, calculé sur l’historique des deux cours. '
                  + result.caveats.join(' ')),
              ]
            : h('p.muted', 'Pas assez d’historique commun entre ' + alt.symbol + ' et le Bitcoin pour calculer un ratio.'),
        ),
      );
    };

    await paint();
    mount(host, container);
  } catch (error) {
    mount(host, errorState(error, { what: 'les projections ALT' }));
  }
}

/* — Simulateur « Et si… » ———————————————————————————————— */

async function renderSimulator(host, btc, assets, model) {
  try {
    const { simulate, HORIZON_UNITS, STRATEGIES } = await import('../engine/simulator.js');
    const alts = await preferredAlts(assets);
    const choices = [btc, ...alts].slice(0, 8);
    const today = new Date().toISOString().slice(0, 10);
    const [btcHistory, scenarios] = await Promise.all([
      repo.getPriceHistory(btc.id, 2200), repo.listScenarios(btc.id),
    ]);

    const state = { asset: btc, amount: 100, start: today, value: 1, unit: 'years', strategy: 'dca' };
    const card = h('div.card.simulator');
    const results = h('div');

    const shiftDate = (years) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() + years);
      return d.toISOString().slice(0, 10);
    };

    const paintControls = () => {
      const unit = HORIZON_UNITS[state.unit];
      const dateInput = h('input.date-input', {
        type: 'date', value: state.start, 'aria-label': 'Date de début',
        onchange: (event) => { if (event.target.value) { state.start = event.target.value; update(); } },
      });
      const amountInput = h('input.amount-input', {
        type: 'number', min: '1', step: '10', inputmode: 'decimal', value: state.amount, 'aria-label': 'Montant par achat',
        onchange: (event) => { state.amount = Math.max(1, Number(event.target.value) || state.amount); update(); },
      });
      mount(card,
        h('div.eyebrow', 'Crypto'),
        h('div.chip-line', choices.map((a) => h('button.chip', {
          type: 'button', 'data-sound': 'select', 'aria-pressed': String(a.id === state.asset.id),
          onclick: () => { state.asset = a; update(); },
        }, a.symbol))),

        h('div.eyebrow', { style: { marginTop: '18px' } }, 'Montant par achat'),
        h('div.chip-line', [25, 50, 100, 250, 500].map((v) => h('button.chip', {
          type: 'button', 'data-sound': 'select', 'aria-pressed': String(state.amount === v),
          onclick: () => { state.amount = v; update(); },
        }, `${v} €`)), amountInput),

        h('div.eyebrow', { style: { marginTop: '18px' } }, 'À partir du'),
        h('div.chip-line',
          [['Il y a 3 ans', -3], ['Il y a 1 an', -1], ['Aujourd’hui', 0], ['Dans 1 an', 1]].map(([label, years]) => h('button.chip', {
            type: 'button', 'data-sound': 'select', 'aria-pressed': String(state.start === shiftDate(years)),
            onclick: () => { state.start = shiftDate(years); update(); },
          }, label)),
          dateInput),

        h('div.eyebrow', { style: { marginTop: '18px' } }, 'Pendant'),
        h('div.horizon',
          h('div.stepper',
            h('button', { type: 'button', 'aria-label': 'Moins', 'data-sound': 'tap',
              onclick: () => { state.value = Math.max(1, state.value - 1); update(); } }, '−'),
            h('span.num', String(state.value)),
            h('button', { type: 'button', 'aria-label': 'Plus', 'data-sound': 'tap',
              onclick: () => { state.value = Math.min(unit.max, state.value + 1); update(); } }, '+')),
          h('div.segmented', Object.entries(HORIZON_UNITS).map(([key, u]) => h('button', {
            type: 'button', 'aria-selected': String(key === state.unit), 'data-sound': 'select',
            onclick: () => { state.unit = key; state.value = Math.min(state.value, u.max); update(); },
          }, u.label)))),
        h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', marginTop: '6px' } },
          `Maximum ${unit.max} ${unit.label} · achat ${unit.cadenceLabel}`),
        results,
      );
    };

    const paintResults = async () => {
      mount(results, loadingBlock(160));
      const history = state.asset.id === btc.id ? btcHistory : await repo.getPriceHistory(state.asset.id, 2200);
      const r = simulate({
        history, btcHistory, start: state.start, value: state.value, unit: state.unit,
        amount: state.amount, scenarios, model, today,
      });
      if (!r.available) { mount(results, h('div.notice', { style: { marginTop: '18px' } }, h('span', glyph('info')), h('div', r.reason))); return; }

      const chosen = r.strategies[state.strategy];
      const ranged = chosen.low !== chosen.high;
      const period = `${fmtDay(r.start, { long: true })} → ${fmtDay(r.end, { long: true })}`;

      mount(results,
        h('div.sim-kind', badge(({ past: 'Rétrospectif · prix réels', future: 'Projection · cycle du Bitcoin', mixed: 'Passé réel + projection' })[r.kind], r.kind === 'past' ? 'info' : 'accent'),
          h('span.muted', { style: { fontSize: 'var(--fs-xs)' } }, period)),

        h('div.strategy-grid', STRATEGIES.map((st) => {
          const res = r.strategies[st.key];
          return h('button.strategy', {
            type: 'button', 'data-sound': 'select', 'aria-pressed': String(st.key === state.strategy),
            onclick: () => { state.strategy = st.key; paintResults(); },
          },
            h('span.strategy__label', st.label),
            h('span.strategy__value.num.sensitive', money(res.final_value, { decimals: 0 })),
            h('span.strategy__roi.num', { class: trendClass(res.roi_pct) }, pct(res.roi_pct, { decimals: 0 })),
          );
        })),

        h('div.sim-detail',
          h('div.muted', { style: { fontSize: 'var(--fs-sm)' } }, STRATEGIES.find((s) => s.key === state.strategy).hint),
          h('div.display.num.sensitive', { style: { fontSize: '30px', marginTop: '6px' } },
            ranged ? range(chosen.low, chosen.high) : money(chosen.final_value, { decimals: 0 })),
          h('div.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '4px' } },
            `pour ${money(chosen.invested, { decimals: 0 })} investis en ${chosen.buys} ${chosen.buys > 1 ? 'achats' : 'achat'}`,
            ranged ? ` · scénario central ${money(chosen.final_value, { decimals: 0 })}` : ''),
          chosen.equity?.length > 2
            ? h('div', { style: { marginTop: '14px' } },
                areaChart(chosen.equity.map((e) => ({ day: e.day, value: e.value })), { height: 120, interactive: true }))
            : null,
          ranged ? h('div.rows', { style: { marginTop: '10px' } }, chosen.scenarios.map((sc) => h('div.row',
            { style: { gridTemplateColumns: 'auto 1fr auto', minHeight: '44px' } },
            h('div.avatar.avatar--dot', { style: { background: ({ bear: 'var(--down)', base: 'var(--zone-neutral)', bull: 'var(--up)' })[sc.kind] } }),
            h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, sc.name)),
            h('div.row__end',
              h('div.row__value.num.sensitive', money(sc.final_value, { decimals: 0 })),
              h('div.row__sub', { class: trendClass(sc.roi_pct) }, pct(sc.roi_pct, { decimals: 0 }))),
          ))) : null,
          h('p.explain__source', { style: { marginTop: '12px' } }, r.note),
        ),
      );
    };

    let timer = null;
    const update = () => {
      paintControls();
      clearTimeout(timer);
      timer = setTimeout(paintResults, 60);
    };

    update();
    mount(host, card);
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

/* — Choix des cryptos suivies (zones, listes) ——————————————— */

async function pickCryptos() {
  const [assets, watch] = await Promise.all([repo.listAssets(), repo.getWatchlist().catch(() => [])]);
  const followed = new Set(watch.map((w) => w.id));
  openSheet({
    title: 'Cryptos suivies',
    build: ({ close }) => {
      const search = h('input', { type: 'search', placeholder: 'Rechercher…', 'aria-label': 'Rechercher une crypto' });
      const list = h('div.rows');
      const paint = () => {
        const q = search.value.trim().toLowerCase();
        mount(list, assets
          .filter((a) => !repo.isStablecoin(a.symbol))
          .filter((a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
          .slice(0, 60)
          .map((a) => h('button.row', {
            type: 'button', 'data-sound': 'toggle',
            onclick: async () => {
              await repo.toggleWatchlist(a.id);
              if (followed.has(a.id)) followed.delete(a.id); else followed.add(a.id);
              paint();
            },
          },
            assetAvatar(a),
            h('div.row__main', h('div.row__title', a.name), h('div.row__sub', a.symbol)),
            h('div.row__end', h('span.check-dot', { 'aria-checked': String(followed.has(a.id)) },
              followed.has(a.id) ? glyph('check', 16) : null)),
          )));
      };
      search.addEventListener('input', paint);
      paint();
      return h('div',
        h('p.muted', { style: { fontSize: 'var(--fs-sm)' } },
          'Les cryptos cochées apparaissent dans les zones, les projections et le simulateur.'),
        h('div.field', { style: { marginTop: '12px' } }, search),
        list,
        h('button.btn.btn--primary.btn--block', { type: 'button', style: { marginTop: '16px' },
          onclick: () => { close(); refresh(); } }, 'Terminé'),
      );
    },
  });
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
            // Un scénario par défaut n'existe pas encore en base : il est créé.
            ...(({ is_default: _d, ...rest }) => rest)(scenario),
            probability: Number(probability.value) / 100,
            assumptions: {
              ...scenario.assumptions,
              multiple_of_200w_ma: Number(multiple.value),
              note: note.value,
            },
          })));
          close();
          toast('Scénarios enregistrés', { kind: 'success' });
          repo.invalidate('scenarios'); refresh();
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
