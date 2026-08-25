/**
 * WALLET · Scénarios et projections (§26, §29, §48)
 *
 * Règle qui gouverne ce fichier : on ne produit JAMAIS un nombre seul.
 * Toute projection sort avec un intervalle, un scénario nommé, et la mention
 * explicite de l'hypothèse qui la fabrique. « BTC vaudra 180 000 € » est
 * interdit ; « scénario central 180 000 €, fourchette 130 000–220 000 » est la
 * seule forme autorisée.
 */

import { piecewise } from './stats.js';

/**
 * Projection de prix Bitcoin à partir de la moyenne 200 semaines.
 *
 * Hypothèse unique et affichée : les sommets de cycle passés se sont situés à
 * un multiple de cette moyenne longue. Le multiple est un PARAMÈTRE, modifiable
 * dans Profil → Avancé. Rien ici n'est une prédiction.
 */
export function projectFromMa200w(ma200w, scenarios = []) {
  if (!Number.isFinite(ma200w) || ma200w <= 0) {
    return { available: false, reason: 'moyenne 200 semaines indisponible' };
  }

  const projections = scenarios
    .map((s) => {
      const multiple = Number(s.assumptions?.multiple_of_200w_ma);
      if (!Number.isFinite(multiple)) return null;
      return {
        name: s.name,
        kind: s.kind,
        multiple,
        target: round2(ma200w * multiple),
        probability: s.probability ?? null,
        assumption: s.assumptions?.note || `${multiple}× la moyenne 200 semaines`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.target - b.target);

  if (!projections.length) return { available: false, reason: 'aucun scénario défini' };

  const central = projections.find((p) => p.kind === 'base') || projections[Math.floor(projections.length / 2)];

  return {
    available: true,
    basis: round2(ma200w),
    basis_label: 'moyenne 200 semaines',
    low: projections[0].target,
    high: projections[projections.length - 1].target,
    central: central.target,
    projections,
    // Espérance pondérée, uniquement si toutes les probabilités sont fournies.
    expected: weightedExpectation(projections),
    disclaimer:
      'Projection fondée sur une seule hypothèse : que les multiples de cycle passés se reproduisent. Rien ne garantit que ce soit le cas.',
  };
}

function weightedExpectation(projections) {
  const withProb = projections.filter((p) => Number.isFinite(p.probability));
  if (withProb.length !== projections.length) return null;
  const total = withProb.reduce((a, p) => a + p.probability, 0);
  if (total <= 0) return null;
  return round2(withProb.reduce((a, p) => a + p.target * p.probability, 0) / total);
}

/**
 * Projection ALT à partir d'un prix BTC hypothétique (§26).
 *
 *   Prix_ALT = Prix_BTC × ratio(ALT/BTC)
 *
 * L'hypothèse implicite — que la capitalisation relative se reproduit — n'a
 * aucune raison structurelle de tenir, et le calcul ignore la dilution par
 * émission de nouveaux jetons. Les deux points sont retournés dans `caveats`
 * pour être affichés, pas enterrés dans une note de bas de page.
 */
export function projectAltFromBtc({ btcPrice, ratios = [], currentAltPrice = null, supplyGrowthPct = null }) {
  if (!Number.isFinite(btcPrice) || btcPrice <= 0) {
    return { available: false, reason: 'prix BTC hypothétique manquant' };
  }

  const results = ratios
    .filter((r) => Number.isFinite(Number(r.ratio)) && Number(r.ratio) > 0)
    .map((r) => {
      const target = btcPrice * Number(r.ratio);
      return {
        label: r.label || sourceLabel(r.source),
        source: r.source || 'user',
        ratio: Number(r.ratio),
        target: round4(target),
        multiple_vs_now: currentAltPrice ? round2(target / currentAltPrice) : null,
      };
    })
    .sort((a, b) => a.target - b.target);

  if (!results.length) return { available: false, reason: 'aucun ratio ALT/BTC défini' };

  const caveats = [
    'Le résultat dépend entièrement du ratio choisi : changez-le, le prix change.',
    'Ce calcul suppose que la capitalisation relative des deux actifs se reproduise.',
  ];
  if (Number.isFinite(supplyGrowthPct) && supplyGrowthPct > 1) {
    caveats.push(
      `La supply de cet actif a augmenté de ${supplyGrowthPct.toFixed(0)} % : à ratio de prix constant, la capitalisation augmente d’autant.`);
  } else {
    caveats.push('La dilution par émission de nouveaux jetons n’est pas prise en compte.');
  }

  return {
    available: true,
    btc_price: btcPrice,
    low: results[0].target,
    high: results[results.length - 1].target,
    central: results[Math.floor(results.length / 2)].target,
    results,
    caveats,
  };
}

function sourceLabel(source) {
  return ({
    historical_high: 'Plus haut du cycle précédent',
    historical_median: 'Médiane historique',
    current: 'Ratio actuel',
    user: 'Votre hypothèse',
  })[source] || 'Votre hypothèse';
}

/**
 * Valeur du portefeuille sous un scénario de prix.
 * Répond à « que vaut mon portefeuille si BTC atteint 200 000 € ? » (§33).
 *
 * Les actifs non-crypto sont laissés à leur valeur actuelle et signalés :
 * on ne fabrique pas une corrélation qu'on n'a pas mesurée.
 */
export function projectPortfolio({ holdings = [], priceOverrides = {}, betaToBtc = {} }) {
  let projected = 0;
  let current = 0;
  let untouched = 0;
  const lines = [];

  for (const h of holdings) {
    const quantity = Number(h.quantity) || 0;
    const price = Number(h.price);
    if (!Number.isFinite(price)) continue;

    const nowValue = quantity * price;
    current += nowValue;

    const override = priceOverrides[h.symbol];
    let futurePrice = price;
    let basis = 'inchangé';

    if (Number.isFinite(override)) {
      futurePrice = override;
      basis = 'scénario';
    } else if (Number.isFinite(betaToBtc[h.symbol]) && Number.isFinite(priceOverrides.BTC)) {
      // Élasticité au BTC fournie explicitement par l'utilisateur.
      const btcMove = priceOverrides.BTC / (priceOverrides.__btcCurrent || priceOverrides.BTC);
      futurePrice = price * (1 + (btcMove - 1) * betaToBtc[h.symbol]);
      basis = 'élasticité BTC';
    } else {
      untouched += nowValue;
    }

    const futureValue = quantity * futurePrice;
    projected += futureValue;

    lines.push({
      symbol: h.symbol,
      quantity,
      price_now: price,
      price_scenario: round4(futurePrice),
      value_now: round2(nowValue),
      value_scenario: round2(futureValue),
      basis,
    });
  }

  return {
    current: round2(current),
    projected: round2(projected),
    delta: round2(projected - current),
    delta_pct: current > 0 ? round2((projected / current - 1) * 100) : null,
    untouched_value: round2(untouched),
    untouched_share: current > 0 ? round2((untouched / current) * 100) : null,
    lines: lines.sort((a, b) => b.value_scenario - a.value_scenario),
    note: untouched > 0
      ? 'Les actifs sans hypothèse de prix sont laissés à leur valeur actuelle.'
      : null,
  };
}

/**
 * Fourchette de confiance autour d'une projection centrale, dérivée de la
 * volatilité historique. Sert à ne jamais afficher un point sans intervalle.
 */
export function projectionRange(central, volatilityPct, horizonMonths = 12) {
  if (!Number.isFinite(central) || !Number.isFinite(volatilityPct)) return null;
  const horizonVol = (volatilityPct / 100) * Math.sqrt(horizonMonths / 12);
  // ±1 écart-type ≈ 68 % des cas si les rendements étaient normaux — ils ne le
  // sont pas, d'où le libellé volontairement prudent.
  return {
    low: round2(central * Math.exp(-horizonVol)),
    high: round2(central * Math.exp(horizonVol)),
    central: round2(central),
    label: 'fourchette indicative à ±1 écart-type',
    caveat: 'Les rendements réels ont des extrêmes plus fréquents que ne le suppose ce calcul.',
  };
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const round4 = (n) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);

export { piecewise };
