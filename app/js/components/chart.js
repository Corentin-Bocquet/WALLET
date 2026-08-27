/**
 * WALLET · Graphiques
 *
 * SVG à la main, sans bibliothèque : le poids transféré compte sur mobile et
 * aucune dépendance ne peut devenir payante ou disparaître.
 *
 * Le style reprend les références jointes : ligne fine, halo lumineux,
 * remplissage en trame de points, pas d'axes ni de grille — sur un écran de
 * téléphone, la forme de la courbe et deux valeurs extrêmes suffisent.
 */

import { h } from '../lib/dom.js';
import { money, day as fmtDay } from '../lib/fmt.js';

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  }
  return el;
};

/**
 * Graphique en aire.
 * @param {Array<{day:string, value:number}>} points
 */
export function areaChart(points, {
  height = 180,
  width = 340,
  color = null,
  showExtremes = true,
  currency = 'EUR',
  interactive = true,
  onScrub = null,
} = {}) {
  const data = (points || [])
    .map((p) => ({ day: p.day, value: Number(p.value ?? p.close ?? p.total_value) }))
    .filter((p) => Number.isFinite(p.value));

  if (data.length < 2) {
    return h('div.empty', { style: { padding: '32px 0' } },
      h('p.muted', 'Pas encore assez de données pour tracer une courbe.'));
  }

  const id = `chart-${++uid}`;
  const values = data.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;

  // Marge verticale pour que la ligne ne touche jamais les bords.
  const padTop = 14;
  const padBottom = 22;
  const usable = height - padTop - padBottom;

  const x = (i) => (i / (data.length - 1)) * width;
  const y = (v) => padTop + usable - ((v - min) / span) * usable;

  const rising = values[values.length - 1] >= values[0];
  const stroke = color || (rising ? 'var(--accent)' : 'var(--down)');

  let line = '';
  data.forEach((p, i) => { line += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`; });
  const area = `${line}L${width},${height - padBottom}L0,${height - padBottom}Z`;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%', height,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': `Évolution de ${money(values[0], { currency })} à ${money(values[values.length - 1], { currency })}`,
  });
  svg.style.overflow = 'visible';
  svg.style.display = 'block';

  const defs = svgEl('defs');

  // Trame de points, exactement l'effet des captures de référence.
  const pattern = svgEl('pattern', {
    id: `${id}-dots`, width: 5, height: 5, patternUnits: 'userSpaceOnUse',
  });
  pattern.append(svgEl('circle', { cx: 1, cy: 1, r: 0.7, fill: stroke, opacity: 0.35 }));
  defs.append(pattern);

  // Dégradé de fondu vers le bas, pour que la trame s'éteigne.
  const fade = svgEl('linearGradient', { id: `${id}-fade`, x1: 0, y1: 0, x2: 0, y2: 1 });
  fade.append(svgEl('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 0.9 }));
  fade.append(svgEl('stop', { offset: '100%', 'stop-color': '#fff', 'stop-opacity': 0 }));
  defs.append(fade);

  const mask = svgEl('mask', { id: `${id}-mask` });
  mask.append(svgEl('rect', { x: 0, y: 0, width, height, fill: `url(#${id}-fade)` }));
  defs.append(mask);

  const glow = svgEl('filter', { id: `${id}-glow`, x: '-20%', y: '-40%', width: '140%', height: '180%' });
  glow.innerHTML = '<feGaussianBlur stdDeviation="3.2" result="b"/>'
    + '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.append(glow);

  svg.append(defs);
  svg.append(svgEl('path', { d: area, fill: `url(#${id}-dots)`, mask: `url(#${id}-mask)` }));
  svg.append(svgEl('path', {
    d: line, fill: 'none', stroke, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    filter: `url(#${id}-glow)`, 'vector-effect': 'non-scaling-stroke',
  }));

  const wrapper = h('div', { style: { position: 'relative' } });
  wrapper.append(svg);

  if (showExtremes) {
    const maxIndex = values.indexOf(max);
    const minIndex = values.indexOf(min);
    wrapper.append(
      extremeLabel(money(max, { currency, compact: true }), x(maxIndex) / width, 'top'),
      extremeLabel(money(min, { currency, compact: true }), x(minIndex) / width, 'bottom'),
    );
  }

  if (interactive) attachScrub(wrapper, svg, { data, x, y, width, height, stroke, currency, onScrub });

  return wrapper;
}

function extremeLabel(text, ratio, position) {
  const left = Math.min(88, Math.max(2, ratio * 100));
  return h('span.num', {
    style: {
      position: 'absolute',
      [position]: position === 'top' ? '-6px' : '0px',
      left: `${left}%`,
      transform: left > 70 ? 'translateX(-100%)' : 'none',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-3)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    },
  }, text);
}

/** Suivi au doigt : affiche la valeur du point survolé. */
function attachScrub(wrapper, svg, { data, x, y, width, height, stroke, currency, onScrub }) {
  const cursor = svgEl('line', {
    y1: 0, y2: height - 22, stroke: 'var(--text-3)', 'stroke-width': 1,
    'stroke-dasharray': '3 3', opacity: 0,
  });
  const dot = svgEl('circle', { r: 4.5, fill: stroke, stroke: 'var(--bg)', 'stroke-width': 2, opacity: 0 });
  svg.append(cursor, dot);

  const readout = h('div.num', {
    style: {
      position: 'absolute', top: '-2px', right: '0',
      fontSize: 'var(--fs-sm)', fontWeight: '600',
      background: 'var(--bg)', padding: '0 4px',
      opacity: '0', transition: 'opacity 120ms', pointerEvents: 'none',
    },
  });
  wrapper.append(readout);

  const move = (event) => {
    const rect = wrapper.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (data.length - 1));
    const point = data[index];
    if (!point) return;

    cursor.setAttribute('x1', x(index));
    cursor.setAttribute('x2', x(index));
    cursor.setAttribute('opacity', '0.5');
    dot.setAttribute('cx', x(index));
    dot.setAttribute('cy', y(point.value));
    dot.setAttribute('opacity', '1');

    readout.textContent = `${money(point.value, { currency })} · ${fmtDay(point.day)}`;
    readout.style.opacity = '1';
    onScrub?.(point, index);
  };

  const end = () => {
    cursor.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
    readout.style.opacity = '0';
    onScrub?.(null, null);
  };

  wrapper.addEventListener('pointerdown', move, { passive: true });
  wrapper.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') move(e); }, { passive: true });
  wrapper.addEventListener('pointerup', end, { passive: true });
  wrapper.addEventListener('pointerleave', end, { passive: true });
  wrapper.addEventListener('pointercancel', end, { passive: true });
}

/**
 * Courbe minuscule, pour les lignes de liste (une par actif).
 */
export function sparkline(values, { width = 64, height = 24, color } = {}) {
  const data = (values || []).map(Number).filter(Number.isFinite);
  if (data.length < 2) return h('span', { style: { width: `${width}px` } });

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stroke = color || (data[data.length - 1] >= data[0] ? 'var(--up)' : 'var(--down)');

  let d = '';
  data.forEach((v, i) => {
    const px = (i / (data.length - 1)) * width;
    const py = height - 2 - ((v - min) / span) * (height - 4);
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
  });

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true' });
  svg.append(svgEl('path', { d, fill: 'none', stroke, 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
  return svg;
}

/**
 * Bulles de répartition, reprises de l'écran « Stats » des références :
 * l'aire de chaque bulle est proportionnelle au montant, ce qui se lit bien
 * plus vite qu'un camembert.
 */
export function bubbleChart(items, { size = 320, currency = 'EUR', onSelect = null } = {}) {
  const data = (items || [])
    .map((it) => ({ ...it, value: Math.abs(Number(it.value ?? it.total)) }))
    .filter((it) => Number.isFinite(it.value) && it.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  if (!data.length) {
    return h('div.empty', h('p.muted', 'Rien à afficher pour cette période.'));
  }

  const total = data.reduce((a, it) => a + it.value, 0);

  // L'AIRE doit être proportionnelle au montant, pas le rayon : sinon un
  // écart de 1 à 4 paraît un écart de 1 à 16.
  const maxRadius = size * 0.26;
  const minRadius = size * 0.055;
  const radii = data.map((it) =>
    Math.max(minRadius, maxRadius * Math.sqrt(it.value / data[0].value)));

  const placed = pack(radii, size);

  // Le cadre est ajusté au contenu réel plutôt que fixé à l'avance : quelle
  // que soit la disposition trouvée, aucune bulle ne peut être rognée.
  const pad = 4;
  const minX = Math.min(...placed.map((p, i) => p.cx - radii[i])) - pad;
  const maxX = Math.max(...placed.map((p, i) => p.cx + radii[i])) + pad;
  const minY = Math.min(...placed.map((p, i) => p.cy - radii[i])) - pad;
  const maxY = Math.max(...placed.map((p, i) => p.cy + radii[i])) + pad;

  const svg = svgEl('svg', {
    viewBox: `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`,
    width: '100%',
    style: 'max-width:340px;max-height:300px;margin-inline:auto;display:block',
    role: 'img', 'aria-label': 'Répartition par catégorie',
  });

  data.forEach((item, i) => {
    const { cx, cy } = placed[i];
    const r = radii[i];
    const share = Math.round((item.value / total) * 100);

    const group = svgEl('g', onSelect ? { style: 'cursor:pointer' } : {});
    const title = svgEl('title');
    title.textContent = `${item.label} : ${money(item.value, { currency })} (${share} %)`;
    group.append(title);

    group.append(svgEl('circle', { cx, cy, r, fill: item.color || 'var(--surface-2)' }));

    // On n'écrit dans la bulle que si le texte y tient vraiment. Une bulle
    // trop petite garde son infobulle et la légende qui suit.
    const amountSize = Math.min(r * 0.34, 20);
    if (amountSize >= 10) {
      const amount = svgEl('text', {
        x: cx, y: cy + (r > 44 ? -1 : 4), 'text-anchor': 'middle',
        'font-size': amountSize.toFixed(1), 'font-weight': 700, fill: '#0A0A0A',
      });
      amount.textContent = money(item.value, { currency, compact: true, decimals: 0 });
      group.append(amount);

      const labelSize = amountSize * 0.62;
      if (r > 44 && labelSize >= 8) {
        const label = svgEl('text', {
          x: cx, y: cy + amountSize * 0.95, 'text-anchor': 'middle',
          'font-size': labelSize.toFixed(1), fill: 'rgba(0,0,0,.66)',
        });
        label.textContent = truncate(item.label, Math.floor(r / 3.4));
        group.append(label);
      }
    }

    if (onSelect) group.addEventListener('click', () => onSelect(item));
    svg.append(group);
  });

  return svg;
}

const truncate = (text, max) =>
  (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

/**
 * Placement sans chevauchement.
 *
 * La plus grosse bulle occupe le centre ; les suivantes sont posées en
 * couronne, chacune à la première position angulaire libre. Le résultat est
 * déterministe — deux rendus des mêmes données donnent la même image, ce qui
 * évite que la répartition « bouge » à chaque rafraîchissement.
 */
function pack(radii, size) {
  const placed = [];
  const cx = size / 2;
  const cy = size / 2;
  const gap = 3;

  radii.forEach((r, i) => {
    if (i === 0) { placed.push({ cx, cy, r }); return; }

    let best = null;
    // On essaie des couronnes de plus en plus larges autour du centre.
    for (let ring = 0; ring < 14 && !best; ring += 1) {
      const distance = radii[0] + r + gap + ring * (size * 0.028);
      for (let step = 0; step < 24; step += 1) {
        // Départ à -100°, sens horaire : la deuxième bulle se pose en haut
        // à droite, comme sur les références.
        const angle = (-100 + step * (360 / 24)) * (Math.PI / 180);
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;

        if (placed.some((p) => Math.hypot(p.cx - x, p.cy - y) < p.r + r + gap)) continue;

        best = { cx: x, cy: y, r };
        break;
      }
    }

    // Repli : aucune position libre trouvée (cas théorique, 14 couronnes
    // × 24 angles). On pose la bulle à droite de l'ensemble.
    placed.push(best ?? { cx: cx + radii[0] + r + gap, cy, r });
  });

  return placed;
}

/**
 * Barre de zones (§28) avec curseur : cinq bandes colorées et un repère.
 */
export function zoneBar(score, thresholds) {
  const bar = h('div', { style: { position: 'relative', paddingTop: '6px' } });
  const track = h('div.zonebar');

  const bands = [
    { key: 'distribution', from: 0, to: thresholds.expensive },
    { key: 'expensive', from: thresholds.expensive, to: thresholds.neutral },
    { key: 'neutral', from: thresholds.neutral, to: thresholds.interesting },
    { key: 'interesting', from: thresholds.interesting, to: thresholds.exceptional },
    { key: 'exceptional', from: thresholds.exceptional, to: 100 },
  ];

  for (const band of bands) {
    track.append(h('span', {
      style: {
        flex: `${Math.max(0, band.to - band.from)}`,
        background: `var(--zone-${band.key})`,
      },
    }));
  }

  bar.append(track);
  if (Number.isFinite(score)) {
    bar.append(h('div.zone-cursor', { style: { left: `${Math.min(100, Math.max(0, score))}%` } }));
  }
  return bar;
}

/**
 * Barres horizontales simples, pour les répartitions détaillées.
 */
export function barList(items, { currency = 'EUR', onSelect } = {}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value ?? i.total)), 1);
  return h('div.rows',
    items.map((item) => {
      const value = Math.abs(item.value ?? item.total);
      const row = h('button.row', { type: 'button', 'data-sound': 'select',
        onclick: onSelect ? () => onSelect(item) : null },
        h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } }, item.emoji || '📦'),
        h('div.row__main',
          h('div.row__title', item.label),
          h('div.meter', { style: { marginTop: '6px', height: '6px' } },
            h('div.meter__fill', { style: { width: `${(value / max) * 100}%`, background: item.color } })),
        ),
        h('div.row__end',
          h('div.row__value.sensitive', money(value, { currency, decimals: 0 })),
          item.share !== null && item.share !== undefined
            ? h('div.row__sub', `${Math.round(item.share)} %`) : null,
        ),
      );
      return row;
    }),
  );
}


/**
 * Jauge en arc, pour une valeur bornée de 0 à 100.
 *
 * Cinq segments plutôt qu'un dégradé : une humeur de marché se lit par
 * paliers (« peur extrême », « cupidité »), pas au point de pourcentage
 * près. Le curseur dit où l'on est, les couleurs disent ce que ça vaut.
 */
export function arcGauge(value, { label = null, size = 240, thickness = 18 } = {}) {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const known = Number.isFinite(value);
  const clamped = known ? Math.min(100, Math.max(0, value)) : 0;

  const w = size;
  const h = size * 0.60;
  const cx = w / 2;
  const cy = h - thickness * 0.4;
  const r = (w - thickness) / 2;

  // Cinq paliers, du plus craintif au plus cupide.
  const BANDS = [
    { to: 20,  color: '#8E2230' },
    { to: 40,  color: '#E0525F' },
    { to: 60,  color: '#F2CE4B' },
    { to: 80,  color: '#5FD79B' },
    { to: 100, color: '#2F9E63' },
  ];

  const pointAt = (pct) => {
    const angle = Math.PI * (1 - pct / 100);
    return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
  };

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', known ? `${Math.round(clamped)} sur 100` : 'Valeur inconnue');
  svg.style.maxWidth = `${w}px`;

  let from = 0;
  for (const band of BANDS) {
    // Un cheveu d'écart entre les segments : ils restent lisibles sans
    // trait de séparation, qui alourdirait la figure.
    const [x1, y1] = pointAt(from + 1.2);
    const [x2, y2] = pointAt(band.to - 1.2);
    const arc = document.createElementNS(SVGNS, 'path');
    arc.setAttribute('d', `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`);
    arc.setAttribute('stroke', known ? band.color : 'var(--surface-2)');
    arc.setAttribute('stroke-width', thickness);
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('fill', 'none');
    svg.append(arc);
    from = band.to;
  }

  if (known) {
    const [px, py] = pointAt(clamped);
    const halo = document.createElementNS(SVGNS, 'circle');
    halo.setAttribute('cx', px); halo.setAttribute('cy', py);
    halo.setAttribute('r', thickness * 0.62);
    halo.setAttribute('fill', 'var(--bg-elevated, #16181d)');
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py);
    dot.setAttribute('r', thickness * 0.44);
    dot.setAttribute('fill', '#fff');
    svg.append(halo, dot);
  }

  const band = BANDS.find((b) => clamped <= b.to) ?? BANDS[BANDS.length - 1];

  return h('div.gauge', { style: { position: 'relative' } },
    svg,
    h('div', {
      style: {
        position: 'absolute', left: '0', right: '0', bottom: `${thickness * 0.2}px`,
        display: 'grid', justifyItems: 'center', gap: '2px', pointerEvents: 'none',
      },
    },
      h('div.gauge__value', { style: { color: known ? '#fff' : 'var(--text-3)' } },
        known ? String(Math.round(clamped)) : '—'),
      label ? h('div.gauge__label', { style: { color: known ? band.color : 'var(--text-3)' } }, label) : null,
    ),
  );
}
