/**
 * WALLET · Bulles d'explication des chiffres clés
 *
 * Le glossaire dit ce qu'EST un indicateur. Ici on dit ce qu'il VEUT DIRE,
 * pour cette crypto, aujourd'hui, avec ses vrais chiffres : une phrase
 * simple, un exemple concret en euros, et pourquoi ça compte.
 *
 * Tout est calculé sur l'appareil, sans IA : c'est instantané, gratuit, et
 * un chiffre cité est toujours le chiffre affiché à l'écran.
 *
 * Chaque fonction reçoit { symbol, name, quote, value, extra } et renvoie
 * { title, simple, now, example, why }. Un champ absent n'est pas affiché.
 */

import { money, pct, compact, bigMoney, day as fmtDay } from '../lib/fmt.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const eur = (v) => money(v, { decimals: Math.abs(v) >= 100 ? 0 : 2 });
const pctPlain = (v, decimals = 0) => pct(v, { decimals, sign: false });
const growth = (p) => (p >= 0 ? `a pris ${pctPlain(p, 1)}` : `a perdu ${pctPlain(Math.abs(p), 1)}`);
const hundredBecomes = (changePct) => eur(100 * (1 + changePct / 100));

function sizeOf(cap) {
  if (cap >= 100e9) return 'une géante du marché';
  if (cap >= 10e9) return 'une grosse crypto';
  if (cap >= 1e9) return 'une crypto de taille moyenne';
  return 'une petite crypto, donc plus risquée et plus nerveuse';
}

export const METRICS = {
  market_cap: ({ symbol, quote }) => {
    const cap = quote.market_cap;
    return {
      title: 'Capitalisation',
      simple: 'Le prix d’une pièce multiplié par le nombre de pièces qui existent. C’est la « taille » de la crypto.',
      now: finite(cap)
        ? `Pour acheter tous les ${symbol} en circulation au prix actuel, il faudrait environ ${bigMoney(cap)}. C’est ${sizeOf(cap)}.`
        : null,
      example: 'Une crypto à 1 € avec 1 milliard de pièces pèse autant qu’une crypto à 1 000 € avec 1 million de pièces. Le prix d’une pièce seul ne dit donc pas si une crypto est grosse ou « pas chère ».',
      why: 'Plus une crypto est grosse, plus il faut d’argent pour faire bouger son prix. Doubler est beaucoup plus dur pour une géante que pour une petite, mais la petite peut aussi s’effondrer beaucoup plus vite.',
    };
  },

  volume_24h: ({ symbol, quote }) => {
    const vol = quote.volume_24h;
    const ratio = finite(vol) && finite(quote.market_cap) && quote.market_cap > 0
      ? (vol / quote.market_cap) * 100 : null;
    let mood = null;
    if (ratio !== null) {
      mood = ratio < 2 ? 'C’est calme : peu de monde achète ou vend en ce moment.'
        : ratio < 10 ? 'C’est une activité normale.'
          : 'C’est très agité : beaucoup de monde achète ou vend, souvent après une nouvelle.';
    }
    return {
      title: 'Volume 24 h',
      simple: `Combien d’argent a été échangé sur le ${symbol} ces dernières 24 heures, en achats et en ventes.`,
      now: finite(vol)
        ? `${bigMoney(vol)} ont changé de mains${ratio !== null ? `, soit ${pctPlain(ratio, 1)} de sa capitalisation` : ''}. ${mood ?? ''}`.trim()
        : null,
      example: 'C’est comme le nombre de clients dans un magasin. Beaucoup de monde : tu peux acheter ou revendre vite sans faire bouger le prix. Magasin vide : ta seule vente peut faire baisser le prix.',
      why: 'Une hausse avec beaucoup de volume est plus solide qu’une hausse avec peu de volume, parce que beaucoup de gens y ont participé.',
    };
  },

  ath: ({ symbol, quote }) => {
    const { ath, price } = quote;
    const gap = finite(ath) && finite(price) ? ((price / ath) - 1) * 100 : null;
    return {
      title: 'Plus haut historique',
      simple: `Le prix le plus cher jamais payé pour un ${symbol}.`,
      now: finite(ath)
        ? `Record : ${eur(ath)}${quote.ath_date ? `, le ${fmtDay(quote.ath_date, { long: true })}` : ''}.`
          + (gap !== null ? ` Aujourd’hui il vaut ${eur(price)}, soit ${gap >= -0.5 ? 'quasiment au record' : `${pctPlain(Math.abs(gap))} en dessous`}.` : '')
        : null,
      example: gap !== null && gap < -0.5
        ? `Quelqu’un qui a mis 100 € pile au sommet a aujourd’hui ${hundredBecomes(gap)}, s’il n’a rien vendu.`
        : 'Quand le prix est au record, tous ceux qui ont acheté un jour sont gagnants.',
      why: 'C’est un repère psychologique. Beaucoup de gens qui ont acheté au sommet revendent dès qu’ils retrouvent leur mise, ce qui peut freiner la hausse juste en dessous du record.',
    };
  },

  drawdown: ({ symbol, quote, value }) => {
    const d = finite(value) ? value
      : finite(quote.ath) && finite(quote.price) ? ((quote.price / quote.ath) - 1) * 100 : null;
    if (d === null) return { title: 'Distance au plus haut', simple: 'De combien le prix est descendu depuis son record.' };
    const needed = d < 0 ? ((1 / (1 + d / 100)) - 1) * 100 : 0;
    const dec = Math.abs(d) < 20 ? 1 : 0;
    const reading = d > -10 ? 'Le prix est proche de son record : le marché est confiant, parfois trop.'
      : d > -50 ? 'C’est une correction : le prix a reculé, sans s’effondrer.'
        : 'C’est une grosse chute. Ça peut être une occasion… ou une crypto qui ne s’en remettra jamais. Les deux arrivent souvent.';
    return {
      title: 'Distance au plus haut',
      simple: `De combien le prix du ${symbol} est descendu depuis son record.`,
      now: `${symbol} est à ${pctPlain(Math.abs(d), dec)} sous son record. ${reading}`,
      example: d < -1
        ? `100 € placés au sommet valent ${hundredBecomes(d)} aujourd’hui. Piège classique : pour revenir au record, il ne faut pas +${pctPlain(Math.abs(d), dec)}, il faut +${pctPlain(needed, dec)}.`
        : 'Au record, cette distance vaut zéro.',
      why: 'Après une baisse de 50 %, il faut doubler (+100 %) pour revenir au point de départ. Plus la chute est profonde, plus la remontée est longue.',
    };
  },

  atl: ({ symbol, quote }) => {
    const { atl, price } = quote;
    const times = finite(atl) && atl > 0 && finite(price) ? price / atl : null;
    return {
      title: 'Plus bas historique',
      simple: `Le prix le moins cher jamais vu pour un ${symbol}.`,
      now: finite(atl)
        ? `Plus bas : ${money(atl)}${quote.atl_date ? `, le ${fmtDay(quote.atl_date, { long: true })}` : ''}.`
          + (times !== null ? ` Depuis, le prix a été multiplié par ${compact(times)}.` : '')
        : null,
      example: times !== null
        ? `100 € placés à ce plus bas vaudraient environ ${eur(100 * times)} aujourd’hui. Personne n’achète pile au plus bas, mais ça montre le chemin parcouru.`
        : null,
      why: 'Si ce plus bas est récent, c’est un signal d’alerte : la crypto n’a jamais été aussi peu chère. S’il est ancien, elle a déjà beaucoup monté depuis ses débuts.',
    };
  },

  circulating_supply: ({ symbol, quote }) => {
    const { circulating_supply: supply, max_supply: max } = quote;
    const share = finite(supply) && finite(max) && max > 0 ? (supply / max) * 100 : null;
    return {
      title: 'Offre en circulation',
      simple: `Le nombre de pièces ${symbol} qui existent aujourd’hui et peuvent être échangées.`,
      now: finite(supply)
        ? `${compact(supply)} ${symbol} circulent.`
          + (share !== null
            ? ` Il n’y en aura jamais plus de ${compact(max)} : ${pctPlain(share)} existent déjà.`
            : ' Aucun maximum n’est fixé : de nouvelles pièces peuvent encore être créées.')
        : null,
      example: 'C’est comme un gâteau : si on le coupe en plus de parts, chaque part est plus petite. Créer de nouvelles pièces « dilue » celles qui existent.',
      why: 'Une offre limitée (comme le Bitcoin, 21 millions au maximum) protège de la dilution. Une offre qui grossit met une pression à la baisse sur le prix, sauf si la demande grossit aussi.',
    };
  },

  change_7d: ({ symbol, quote }) => changeHelp(symbol, quote.change_7d, 'Sur 7 jours', 'il y a une semaine',
    'Sur une semaine, une crypto bouge beaucoup. Ce chiffre montre l’humeur récente, pas la direction à long terme.'),

  change_1y: ({ symbol, quote }) => changeHelp(symbol, quote.change_1y, 'Sur 1 an', 'il y a un an',
    'Un an lisse le bruit des semaines agitées : c’est un meilleur reflet de la tendance de fond que le 24 h ou le 7 jours.'),

  change_24h: ({ symbol, quote }) => changeHelp(symbol, quote.change_24h, 'Sur 24 h', 'hier à la même heure',
    'En crypto, ±5 % en une journée est banal. Ne pas prendre de décision sur ce seul chiffre.'),

  change_90d: ({ symbol, value }) => changeHelp(symbol, value, 'Performance 90 jours', 'il y a trois mois',
    'Trois mois, c’est la tendance du moment : une hausse de fond, ou une baisse qui s’installe.'),

  cycle_position: ({ symbol, value, extra }) => ({
    title: 'Position dans le cycle',
    simple: 'Une note de 0 à 100 qui situe le prix entre le creux et le sommet de son cycle. 0 = tout en bas, 100 = tout en haut.',
    now: finite(value)
      ? `${symbol} est à ${Math.round(value)} / 100${extra ? ` (${extra})` : ''}. ${value < 30 ? 'On est plutôt près du creux.' : value > 70 ? 'On est plutôt près du sommet.' : 'On est au milieu du cycle.'}`
      : null,
    example: 'Le Bitcoin a vécu des cycles d’environ 4 ans : une grosse hausse, une grosse chute, une longue période calme, puis ça recommence.',
    why: 'Acheter près du creux a historiquement mieux payé qu’acheter près du sommet. Mais le passé ne garantit rien : un cycle peut durer plus longtemps que prévu.',
  }),

  fear_greed: ({ value }) => {
    const v = finite(value) ? value : null;
    const mood = v === null ? null : v < 25 ? 'une grande peur' : v < 45 ? 'de la peur' : v < 55 ? 'de l’hésitation' : v < 75 ? 'de l’envie' : 'une grande avidité';
    return {
      title: 'Humeur du marché',
      simple: 'Une note de 0 à 100 qui mesure si les investisseurs ont peur (0) ou sont avides (100).',
      now: v !== null ? `Aujourd’hui : ${Math.round(v)} / 100, c’est ${mood}.` : null,
      example: 'Quand tout le monde a peur, les prix sont souvent bas, comme des soldes. Quand tout le monde veut acheter, les prix sont souvent chers.',
      why: 'La foule a tendance à acheter trop tard et à vendre trop tôt. Cette note aide à ne pas suivre la foule sur un coup de tête.',
    };
  },

  mayer: ({ symbol, quote, value }) => {
    const v = finite(value) ? value : null;
    const reading = v === null ? null : v < 0.8 ? 'très en dessous de sa moyenne : historiquement une zone froide, où acheter a souvent payé sur le long terme.'
      : v < 1.2 ? 'dans sa moyenne : rien d’extrême.'
        : v < 2.4 ? 'au-dessus de sa moyenne : le marché chauffe.'
          : 'très au-dessus de sa moyenne : historiquement une zone de surchauffe.';
    return {
      title: 'Multiple de Mayer',
      simple: 'Le prix divisé par sa moyenne des 200 derniers jours. 1 = pile dans la moyenne.',
      now: v !== null ? `${symbol} vaut ${v.toFixed(2)} fois sa moyenne : ${reading}` : null,
      example: v !== null && finite(quote.price)
        ? `Moyenne sur 200 jours : environ ${eur(quote.price / v)}. Prix actuel : ${eur(quote.price)}.`
        : null,
      why: 'Un prix trop loin de sa moyenne finit souvent par s’en rapprocher. Mais il peut rester loin pendant des mois.',
    };
  },

  ma200w: ({ symbol, value, extra }) => ({
    title: 'Moyenne 200 semaines',
    simple: 'Le prix divisé par sa moyenne des 200 dernières semaines, soit près de 4 ans. C’est le « plancher » historique du Bitcoin.',
    now: finite(value) ? `${symbol} vaut ${value.toFixed(2)} fois cette moyenne${extra ? ` (${extra})` : ''}. ${value < 1.2 ? 'Il est proche du plancher : rare, et historiquement intéressant.' : value > 3 ? 'Il en est très loin : marché très chaud.' : 'Rien d’extrême.'}` : null,
    example: 'Lors des grosses chutes passées, le Bitcoin est souvent redescendu vers cette moyenne sans aller beaucoup plus bas.',
    why: 'Elle donne une idée de jusqu’où le prix pourrait redescendre dans un scénario pessimiste.',
  }),

  mvrv: ({ symbol, value }) => ({
    title: 'MVRV',
    simple: 'Compare le prix actuel au prix moyen payé par tous les détenteurs. Au-dessus de 1, ils sont en moyenne gagnants.',
    now: finite(value) ? `${symbol} : ${value.toFixed(2)}. ${value < 1 ? 'En moyenne, les détenteurs perdent de l’argent : historiquement une zone de creux.' : value > 3 ? 'Les détenteurs sont en gros bénéfice : beaucoup sont tentés de vendre.' : 'Les détenteurs sont gagnants, sans excès.'}` : null,
    example: 'Si tout le monde a acheté en moyenne à 50 000 € et que le prix est à 100 000 €, le MVRV vaut 2 : chacun a doublé sa mise.',
    why: 'Quand tout le monde est en gros bénéfice, la tentation d’encaisser fait souvent baisser le prix.',
  }),

  volatility: ({ symbol, value }) => ({
    title: 'Volatilité',
    simple: 'À quel point le prix fait le yoyo. Plus le chiffre est grand, plus ça secoue.',
    now: finite(value) ? `${symbol} : ${Math.round(value)} % par an. Une année « normale » peut aller de -${Math.round(value)} % à +${Math.round(value)} %.` : null,
    example: finite(value)
      ? `Avec 1 000 € placés, il est banal de voir ton solde entre ${eur(Math.max(0, 1000 * (1 - value / 100)))} et ${eur(1000 * (1 + value / 100))} dans l’année. Pour comparer, les actions tournent autour de 15 à 20 %.`
      : null,
    why: 'Plus c’est volatil, plus il faut n’y mettre que de l’argent dont tu n’as pas besoin, pour ne pas être forcé de vendre au mauvais moment.',
  }),

  price: ({ symbol, quote }) => changeHelp(symbol, quote.change_24h, `Prix du ${symbol}`, 'hier à la même heure',
    'C’est le dernier prix échangé sur les marchés. Il bouge en continu, jour et nuit, week-end compris.'),
};

function changeHelp(symbol, change, title, since, why) {
  return {
    title,
    simple: `De combien le prix du ${symbol} a bougé depuis ${since}.`,
    now: finite(change) ? `Le ${symbol} ${growth(change)} depuis ${since}.` : null,
    example: finite(change) ? `100 € placés ${since} vaudraient ${hundredBecomes(change)} aujourd’hui.` : null,
    why,
  };
}

export function explainMetric(key, context) {
  const build = METRICS[key];
  if (!build) return null;
  return build({ quote: {}, ...context });
}
