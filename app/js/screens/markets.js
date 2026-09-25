/**
 * WALLET · Marchés — « Que font les marchés ? » (§41)
 *
 * Liste et fiche d'actif. En mode simple : prix, variation, score. En mode
 * avancé : indicateurs, ratios, modèles. Le basculement est un réglage du
 * profil, pas un bouton qui traîne sur chaque écran (§49).
 */

import { h, mount, icon } from '../lib/dom.js';
import { glyph } from '../components/icons.js';
import { navigate } from '../lib/router.js';
import { openSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import {
  screenHead, subScreenHead, section, bigAmount, freshness, loadingRows, currencyToggle,
  emptyState, asyncBlock, badge, changeBadge, estimateBadge, accordion, errorState,
  subNav, MARKETS_NAV, zoneTag,
} from '../components/ui.js';
import { explainChip, labelWithInfo, metricChip, showReasoning } from '../components/explain.js';
import { arcGauge, areaChart, sparkline, zoneBar } from '../components/chart.js';
import { money, pct, num, compact, day as fmtDay, trendClass, score as fmtScore, bigMoney } from '../lib/fmt.js';
import { assetAvatar } from '../components/brand.js';
import * as repo from '../data/repo.js';
import { computeIndicators, fearGreedLabel } from '../engine/indicators.js';
import { computeInvestmentScore, ZONE_META, FACTOR_HELP } from '../engine/score.js';
import { getSettings } from '../data/repo.js';

const TABS = [
  { key: 'watch', label: 'Ma liste' },
  { key: 'all', label: 'Toutes les cryptos' },
  { key: 'winners', label: 'Hausses' },
  { key: 'losers', label: 'Baisses' },
];

export async function marketsScreen() {
  const screen = h('main.screen');
  screen.append(screenHead('Marchés', { right: currencyToggle() }));
  screen.append(subNav(MARKETS_NAV, '/marches'));

  /* Baromètre du marché : deux chiffres, pas un tableau de bord. */
  const barometer = h('div');
  screen.append(barometer);
  renderBarometer(barometer);

  /* Recherche */
  const search = h('input', {
    type: 'search', placeholder: 'Rechercher une crypto…',
    'aria-label': 'Rechercher', autocomplete: 'off',
  });
  screen.append(h('div.field', { style: { marginTop: '20px' } }, search));

  /* Onglets */
  let activeTab = 'watch';
  const list = h('div');
  // Un seul chemin pour changer d'onglet : le bouton « Parcourir toutes les
  // cryptos » de la liste vide changeait la liste sans allumer l'onglet.
  const selectTab = (key) => {
    activeTab = key;
    [...tabs.children].forEach((b, i) => b.setAttribute('aria-selected', String(TABS[i].key === key)));
    paint();
  };
  const tabs = h('div.tabs', { style: { marginTop: '4px' } },
    TABS.map((tab) => h('button', {
      type: 'button', 'aria-selected': String(tab.key === activeTab), 'data-sound': 'select',
      onclick: (event) => {
        selectTab(tab.key);
        event.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      },
    }, tab.label)),
  );

  screen.append(tabs, h('div', { style: { marginTop: '8px' } }, list));

  let assets = [];
  let watchIds = new Set();

  async function paint() {
    mount(list, loadingRows(6));
    try {
      if (!assets.length) {
        const [all, watch] = await Promise.all([repo.listAssets(), repo.getWatchlist()]);
        assets = all;
        watchIds = new Set(watch.map((a) => a.id));
      }

      const query = search.value.trim().toLowerCase();
      let rows = assets;

      // Une recherche porte sur toutes les cryptos : chercher « Cardano »
      // depuis « Ma liste » répondait « Aucun résultat » alors qu'elle existe.
      if (activeTab === 'watch' && !query) rows = rows.filter((a) => watchIds.has(a.id));
      if (activeTab === 'winners') {
        rows = rows.filter((a) => (a.quote?.change_24h ?? 0) > 0)
          .sort((a, b) => (b.quote?.change_24h ?? 0) - (a.quote?.change_24h ?? 0));
      }
      if (activeTab === 'losers') {
        rows = rows.filter((a) => (a.quote?.change_24h ?? 0) < 0)
          .sort((a, b) => (a.quote?.change_24h ?? 0) - (b.quote?.change_24h ?? 0));
      }
      if (query) {
        rows = rows.filter((a) => a.symbol.toLowerCase().includes(query)
          || a.name.toLowerCase().includes(query));
      }

      if (!rows.length) {
        mount(list, emptyState({
          emoji: activeTab === 'watch' ? glyph('star') : glyph('search'),
          title: activeTab === 'watch' ? 'Votre liste est vide' : 'Aucun résultat',
          body: activeTab === 'watch'
            ? 'Ouvrez une crypto et touchez l’étoile pour la suivre ici.'
            : 'Essayez un autre nom ou un autre symbole.',
          action: activeTab === 'watch'
            ? h('button.btn.btn--secondary', {
                type: 'button', onclick: () => selectTab('all'),
              }, 'Parcourir toutes les cryptos')
            : null,
        }));
        return;
      }

      mount(list, h('div.rows', rows.map((asset) => assetRow(asset, watchIds.has(asset.id)))));
    } catch (error) {
      mount(list, errorState(error, { what: 'les marchés', onRetry: paint }));
    }
  }

  let debounce;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(paint, 180);
  });

  paint();
  return screen;
}

function assetRow(asset, watched) {
  const quote = asset.quote || {};
  return h('button.row', {
    type: 'button', 'data-sound': 'select',
    onclick: () => navigate(`/marches/${asset.id}`),
  },
    assetAvatar(asset),
    h('div.row__main',
      h('div.row__title', asset.name, watched ? h('span', { style: { color: 'var(--accent)' } }, ' ★') : null),
      h('div.row__sub', asset.symbol),
    ),
    h('div.row__end',
      h('div.row__value.sensitive', money(quote.price)),
      h('div.row__sub', { class: trendClass(quote.change_24h) },
        Number.isFinite(quote.change_24h) ? pct(quote.change_24h) : '—'),
    ),
  );
}

async function renderBarometer(host) {
  try {
    const indicators = await repo.getMarketIndicators();
    const fg = indicators.fear_greed;
    const value = fg ? Number(fg.value) : null;
    const mood = fearGreedLabel(value);

    mount(host, h('div.card', { style: { marginTop: '4px' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' } },
        h('div.eyebrow', labelWithInfo('Humeur du marché', 'fear_greed')),
        fg?.is_derived ? estimateBadge(repo.isDemoMode() ? 'simulé' : 'estimé') : null,
      ),

      h('div', { style: { marginTop: '10px', display: 'grid', justifyItems: 'center' } },
        arcGauge(value, { label: mood.label })),

      h('div', { style: { marginTop: '8px' } },
        freshness(fg?.fetched_at, { thresholdSeconds: 6 * 3600, message: fg?.source })),
    ));
  } catch {
    mount(host, h('div'));   // un baromètre absent ne doit pas bloquer l'écran
  }
}

/* ================================================================== */
/* Fiche d'un actif                                                    */
/* ================================================================== */

// « Max » demande vingt ans : le serveur renvoie tout ce qu'il a, depuis la
// première cotation connue de l'actif.
const MAX_DAYS = 7300;
const RANGES = [
  { key: 30, label: '1 M' },
  { key: 90, label: '3 M' },
  { key: 365, label: '1 A' },
  { key: 1825, label: '5 A' },
  { key: MAX_DAYS, label: 'Max' },
];

export async function assetScreen({ params }) {
  const screen = h('main.screen');
  const asset = await repo.getAsset(params.id);

  if (!asset) {
    screen.append(subScreenHead('Actif introuvable'));
    screen.append(emptyState({ emoji: glyph('question'), title: 'Cet actif n’existe pas', body: 'Il a peut-être été retiré du suivi.' }));
    return screen;
  }

  const [settings, watchlist] = await Promise.all([
    getSettings().catch(() => ({ ui_mode: 'simple' })),
    repo.getWatchlist().catch(() => []),
  ]);
  let watched = watchlist.some((a) => a.id === asset.id);
  const advanced = settings.ui_mode === 'advanced';

  // L'étoile change de couleur AVANT l'aller-retour serveur : un favori est
  // une intention, pas une transaction. Si le serveur refuse, on revient en
  // arrière et on le dit — plutôt que de laisser l'étoile figée sans un mot.
  // Étoile pleine quand l'actif est suivi, comme le ★ de la liste.
  const paintStar = (button, on) => {
    button.style.color = on ? 'var(--accent)' : 'var(--text-2)';
    const svg = button.querySelector('svg');
    if (svg) svg.style.fill = on ? 'currentColor' : 'none';
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Retirer de ma liste' : 'Ajouter à ma liste');
  };

  const star = h('button.icon-btn', {
    type: 'button', 'data-sound': 'toggle',
    'aria-pressed': String(watched),
    'aria-label': watched ? 'Retirer de ma liste' : 'Ajouter à ma liste',
    style: { color: watched ? 'var(--accent)' : 'var(--text-2)', transition: 'color .15s ease' },
    onclick: async (event) => {
      const button = event.currentTarget;
      const previous = watched;
      watched = !previous;
      paintStar(button, watched);
      try {
        watched = await repo.toggleWatchlist(asset.id);
        paintStar(button, watched);
        toast(watched ? `${asset.symbol} ajouté à votre liste` : `${asset.symbol} retiré`);
      } catch (error) {
        watched = previous;
        paintStar(button, watched);
        toast('Impossible de modifier votre liste.', { kind: 'error' });
      }
    },
  }, glyph('star'));
  paintStar(star, watched);

  screen.append(subScreenHead(asset.name, { right: star }));

  const quote = asset.quote || {};
  screen.append(
    bigAmount(quote.price, {
      label: h('span', { style: { display: 'inline-flex', alignItems: 'center' } },
        asset.symbol, metricChip('price', { symbol: asset.symbol, quote })),
      changePct: quote.change_24h,
      changeLabel: 'sur 24 h',
    }),
    h('div', { style: { marginTop: '8px' } },
      freshness(quote.fetched_at, { message: repo.isDemoMode() ? 'Prix simulé (démonstration)' : null })),
  );

  /* Graphique + plages */
  const chartHost = h('div', { style: { marginTop: '20px' } });
  screen.append(chartHost);

  let days = 365;
  const ranges = h('div.segmented', { style: { marginTop: '12px' } },
    RANGES.map((range) => h('button', {
      type: 'button', 'aria-selected': String(range.key === days), 'data-sound': 'select',
      onclick: () => {
        days = range.key;
        [...ranges.children].forEach((b, i) => b.setAttribute('aria-selected', String(RANGES[i].key === days)));
        drawChart();
      },
    }, range.label)),
  );
  screen.append(ranges);

  let history = [];
  async function drawChart() {
    mount(chartHost, h('div.skeleton', { style: { height: '180px' } }));
    try {
      if (!history.length) history = await repo.getPriceHistory(asset.id, MAX_DAYS);
      const slice = thin(history.slice(-days), 900);
      mount(chartHost, areaChart(slice.map((p) => ({ day: p.day, value: Number(p.close) })), { height: 180 }));
      const first = history[0]?.day;
      if (days === MAX_DAYS && first) {
        chartHost.append(h('p.muted', { style: { fontSize: 'var(--fs-xs)', marginTop: '6px', textAlign: 'center' } },
          `Historique disponible depuis le ${fmtDay(first, { long: true })}`));
      }
    } catch (error) {
      mount(chartHost, errorState(error, { what: "l'historique", onRetry: drawChart }));
    }
  }
  await drawChart();

  /* Score et zone : le résumé utile, avant les détails */
  const scoreHost = h('div');
  screen.append(section('Ce que WALLET en pense', {
    explain: 'investment_score',
  }, scoreHost));
  mount(scoreHost, h('div.skeleton', { style: { height: '140px' } }));

  /* Chiffres clés, toujours visibles mais compacts */
  screen.append(section('Chiffres clés', {}, keyFigures(asset, quote)));

  /* Indicateurs : masqués par défaut en mode simple (§39, §49) */
  const indicatorsHost = h('div');
  screen.append(section('Indicateurs', {}, indicatorsHost));

  renderScoreAndIndicators({ asset, scoreHost, indicatorsHost, advanced });

  return screen;
}

function keyFigures(asset, quote) {
  const ctx = { symbol: asset.symbol, name: asset.name, quote };
  const rows = [
    ['Capitalisation', quote.market_cap ? bigMoney(quote.market_cap) : '—', null, 'market_cap'],
    ['Volume 24 h', quote.volume_24h ? bigMoney(quote.volume_24h) : '—', null, 'volume_24h'],
    ['Plus haut historique', quote.ath ? money(quote.ath) : '—', quote.ath_date ? fmtDay(quote.ath_date, { long: true }) : null, 'ath'],
    ['Distance au plus haut',
      quote.ath && quote.price ? pct(((quote.price / quote.ath) - 1) * 100) : '—', null, 'drawdown'],
    ['Plus bas historique', quote.atl ? money(quote.atl) : '—', quote.atl_date ? fmtDay(quote.atl_date, { long: true }) : null, 'atl'],
    ['Offre en circulation', quote.circulating_supply ? compact(quote.circulating_supply) : '—', null, 'circulating_supply'],
    ['Sur 7 jours', Number.isFinite(quote.change_7d) ? pct(quote.change_7d) : '—', null, 'change_7d'],
    ['Sur 1 an', Number.isFinite(quote.change_1y) ? pct(quote.change_1y) : '—', null, 'change_1y'],
  ];

  return h('div.rows',
    rows.map(([label, value, sub, key]) => h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
      h('div.row__main',
        h('div.row__title', { style: { fontWeight: '500', display: 'flex', alignItems: 'center' } },
          label, metricChip(key, ctx, { glossary: key === 'drawdown' ? 'drawdown' : null })),
        sub ? h('div.row__sub', sub) : null,
      ),
      h('div.row__end', h('div.row__value', value)),
    )),
  );
}

async function renderScoreAndIndicators({ asset, scoreHost, indicatorsHost, advanced }) {
  mount(indicatorsHost, h('div.skeleton', { style: { height: '120px' } }));

  try {
    const [history, market, model] = await Promise.all([
      repo.getPriceHistory(asset.id, 1500),
      repo.getMarketIndicators().catch(() => ({})),
      repo.getScoreModel(),
    ]);

    const computed = computeIndicators(history);

    if (!computed.available) {
      mount(scoreHost, h('div.notice',
        h('span', 'ℹ'),
        h('div', h('strong', 'Score indisponible'),
          `Il faut plus d'historique de prix pour calculer un score (${computed.points ?? 0} points connus).`)));
      mount(indicatorsHost, h('p.muted', 'Les indicateurs apparaîtront avec plus d’historique.'));
      return;
    }

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

    mount(scoreHost, scoreCard(asset, result, model));
    mount(indicatorsHost, indicatorList(computed, market, advanced, asset));
  } catch (error) {
    mount(scoreHost, errorState(error, { what: 'le score' }));
    mount(indicatorsHost, h('div'));
  }
}

export function scoreCard(asset, result, model) {
  const zone = ZONE_META[result.zone] || {};

  return h('div.card',
    h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' } },
      h('div',
        h('div.eyebrow', `${asset.symbol} · Investment Score`),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' } },
          h('span.num', { style: { fontSize: '38px', fontWeight: '700' } },
            result.score === null ? '—' : fmtScore(result.score)),
          h('span.muted', { style: { fontSize: '18px' } }, '/100'),
        ),
      ),
      result.zone ? zoneTag(zone, { asBadge: true }) : null,
    ),

    h('div', { style: { marginTop: '18px' } },
      zoneBar(result.score, model.zone_thresholds || {})),

    h('p.muted', { style: { marginTop: '16px', fontSize: 'var(--fs-sm)' } }, result.explanation),

    // La transparence n'est pas une option : le bouton est toujours là (§47).
    h('div', { style: { display: 'flex', gap: '10px', marginTop: '18px' } },
      h('button.btn.btn--sm.btn--secondary', {
        type: 'button', 'data-sound': 'sheetOpen',
        onclick: () => showScoreReasoning(asset, result),
      }, 'Pourquoi ?'),
      h('button.btn.btn--sm.btn--ghost', {
        type: 'button', 'data-sound': 'select',
        onclick: () => navigate('/profil/moteur'),
      }, 'Régler le score'),
    ),

    result.confidence < 0.75
      ? h('div.notice.notice--warn', { style: { marginTop: '14px' } },
          h('span', glyph('alert')),
          h('div', h('strong', 'Score partiel'),
            `${Math.round(result.confidence * 100)} % des facteurs sont renseignés. Les facteurs manquants ne sont pas remplacés par une valeur neutre : ils sont retirés du calcul.`))
      : null,
  );
}

export function showScoreReasoning(asset, result) {
  showReasoning({
    title: `Score de ${asset.symbol}`,
    subtitle: result.explanation,
    factors: result.factors.map((factor) => ({
      label: factor.label + (factor.derived ? ' (estimé)' : ''),
      display: factor.available ? `${factor.value}/100` : 'indisponible',
      weight: factor.weight,
      note: factor.available ? FACTOR_HELP[factor.key] : factor.note,
      color: factor.available ? colorForFactor(factor.value) : 'var(--surface-3)',
    })),
    footnote: `Score = moyenne pondérée des facteurs disponibles. Couverture : ${Math.round(result.confidence * 100)} %. Ce score décrit l'état actuel, il ne prédit rien.`,
  });
}

function colorForFactor(value) {
  if (value >= 70) return 'var(--zone-exceptional)';
  if (value >= 55) return 'var(--zone-interesting)';
  if (value >= 40) return 'var(--zone-neutral)';
  if (value >= 25) return 'var(--zone-expensive)';
  return 'var(--zone-distribution)';
}

function indicatorList(computed, market, advanced, asset) {
  const ctx = { symbol: asset.symbol, name: asset.name, quote: asset.quote || {} };
  const simple = [
    computed.drawdown && {
      code: 'drawdown', label: 'Distance au sommet',
      value: pct(computed.drawdown.value), derived: false,
      help: 'drawdown', raw: computed.drawdown.value,
    },
    computed.cycle && {
      code: 'cycle_position', label: 'Position dans le cycle',
      value: computed.cycle.value === null ? '—' : `${Math.round(computed.cycle.value)} / 100`,
      sub: computed.cycle.phase, derived: computed.cycle.is_derived,
      help: 'cycle_position', raw: computed.cycle.value, extra: computed.cycle.phase,
    },
    market.fear_greed && {
      code: 'fear_greed', label: 'Fear & Greed',
      value: String(market.fear_greed.value), derived: market.fear_greed.is_derived,
      help: 'fear_greed', raw: Number(market.fear_greed.value),
    },
  ].filter(Boolean);

  const expert = [
    computed.mayer && {
      code: 'mayer', label: 'Multiple de Mayer',
      value: computed.mayer.value?.toFixed(2), sub: computed.mayer.note, derived: false,
      help: 'mayer', raw: computed.mayer.value,
    },
    computed.ma200w && {
      code: 'mayer', label: 'Multiple de la moyenne 200 semaines',
      value: computed.ma200w.value?.toFixed(2),
      sub: `Moyenne : ${money(computed.ma200w.reference)}`, derived: false,
      help: 'ma200w', raw: computed.ma200w.value, extra: `moyenne ${money(computed.ma200w.reference)}`,
    },
    computed.mvrv_proxy && {
      code: 'mvrv', label: 'MVRV (approximation)',
      value: computed.mvrv_proxy.value?.toFixed(2),
      sub: computed.mvrv_proxy.note, derived: true,
      help: 'mvrv', raw: computed.mvrv_proxy.value,
    },
    computed.volatility && {
      code: 'drawdown', label: 'Volatilité annualisée',
      value: computed.volatility.value === null ? '—' : `${Math.round(computed.volatility.value)} %`,
      sub: computed.volatility.note, derived: false,
      help: 'volatility', raw: computed.volatility.value,
    },
    computed.momentum && {
      code: 'mayer', label: 'Performance 90 jours',
      value: pct(computed.momentum.value_90d), derived: false,
      help: 'change_90d', raw: computed.momentum.value_90d,
    },
  ].filter(Boolean);

  const render = (items) => h('div.rows', items.map((item) => h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.row__main',
      h('div.row__title', { style: { fontWeight: '500', display: 'flex', alignItems: 'center' } },
        item.label, item.help
          ? metricChip(item.help, { ...ctx, value: item.raw, extra: item.extra }, { glossary: item.code })
          : explainChip(item.code, { label: item.label })),
      item.sub ? h('div.row__sub', { style: { whiteSpace: 'normal' } }, item.sub) : null,
    ),
    h('div.row__end',
      h('div.row__value', item.value ?? '—'),
      item.derived ? estimateBadge() : null,
    ),
  )));

  return h('div',
    render(simple),
    // En mode simple, l'expertise existe mais reste repliée (§39).
    expert.length
      ? accordion(advanced ? 'Indicateurs avancés' : 'Voir les indicateurs avancés',
          () => render(expert), { open: advanced })
      : null,
  );
}

/** Allège une longue série pour le tracé, en gardant toujours le dernier point. */
function thin(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}
