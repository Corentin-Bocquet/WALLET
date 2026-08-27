/**
 * WALLET · Portefeuille — « Où est mon argent ? » (§41)
 */

import { h, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { openSheet, confirmSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import {
  screenHead, section, bigAmount, freshness, partialNotice, loadingRows, currencyToggle,
  loadingBlock, emptyState, asyncBlock, errorState, badge, seeAll,
} from '../components/ui.js';
import { explainChip } from '../components/explain.js';
import { areaChart, bubbleChart, barList } from '../components/chart.js';
import { money, pct, num, day as fmtDay, trendClass } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { analyseBehaviour } from '../engine/behaviour.js';

export async function portfolioScreen() {
  const screen = h('main.screen');

  screen.append(screenHead('Portefeuille', {
    right: h('div.head__tools',
      currencyToggle({ compact: true }),
      h('button.icon-btn', {
        type: 'button', 'aria-label': 'Synchroniser', 'data-sound': 'select',
        onclick: (event) => sync(event.currentTarget),
      }, '⟳'),
    ),
  }));

  const hero = h('div');
  screen.append(hero);
  mount(hero, loadingBlock(180));
  renderHero(hero);

  /* Répartition : une image, pas un tableau */
  const split = h('div');
  screen.append(section('Répartition', {}, split));
  mount(split, loadingBlock(240));
  renderSplit(split);

  /* Positions */
  const positions = h('div');
  screen.append(section('Mes positions', {
    action: h('button.btn.btn--ghost.btn--sm', {
      type: 'button', 'data-sound': 'sheetOpen', onclick: () => openAddHolding(),
    }, '+ Ajouter'),
  }, positions));
  mount(positions, loadingRows(4));
  renderPositions(positions);

  /* Comptes */
  screen.append(section('Mes comptes', {
    action: seeAll('Gérer', () => navigate('/profil/comptes')),
  }, asyncBlock(
    Promise.all([repo.getAccounts(), repo.getHoldings().catch(() => [])]),
    {
    loading: () => loadingRows(3),
    render: ([accounts, holdings]) => renderAccounts(accounts, holdings),
    empty: () => emptyState({
      emoji: '🏦',
      title: 'Aucun compte',
      body: 'Ajoutez un compte pour commencer à suivre votre patrimoine.',
      action: h('button.btn.btn--primary', { type: 'button', onclick: () => navigate('/profil/comptes') },
        'Ajouter un compte'),
    }),
    what: 'vos comptes',
  })));

  /* Comportement d'investissement (§31) */
  const behaviour = h('div');
  screen.append(section('Vos habitudes d’investissement', {}, behaviour));
  mount(behaviour, loadingRows(2));
  renderBehaviour(behaviour);

  return screen;
}

async function sync(button) {
  button.textContent = '…';
  button.disabled = true;
  try {
    await repo.triggerSync('kraken');
    toast('Synchronisation lancée', { kind: 'success' });
  } catch (error) {
    // En mode démonstration, il n'y a rien à synchroniser : le dire franchement.
    toast(repo.isDemoMode()
      ? 'Rien à synchroniser en mode démonstration'
      : `Synchronisation impossible : ${error.message}`, { kind: 'error' });
  } finally {
    button.textContent = '⟳';
    button.disabled = false;
    setTimeout(() => window.location.reload(), 600);
  }
}

async function renderHero(host) {
  try {
    const [netWorth, sync] = await Promise.all([repo.getNetWorth(), repo.getSyncState().catch(() => ({}))]);
    const series = netWorth.series || [];

    mount(host,
      bigAmount(netWorth.total, {
        label: 'Valeur totale',
        explain: 'net_worth',
        change: netWorth.change_30d,
        changePct: netWorth.change_30d_pct,
        changeLabel: 'sur 30 jours',
      }),
      h('div', { style: { marginTop: '10px' } },
        freshness(sync.market?.last_success ?? sync.kraken?.last_success, {
          status: sync.market?.status, message: sync.market?.message, thresholdSeconds: 3600,
        })),
      netWorth.is_partial
        ? h('div', { style: { marginTop: '14px' } },
            partialNotice(netWorth.unknown, { onFix: () => navigate('/profil/comptes') }))
        : null,
      netWorth.stale_prices?.length
        ? h('div.notice.notice--warn', { style: { marginTop: '12px' } },
            h('span', '🕒'),
            h('div', h('strong', 'Prix anciens'),
              `${netWorth.stale_prices.join(', ')} : le dernier prix connu date d'un moment. La valeur affichée peut avoir bougé.`))
        : null,
      series.length > 2
        ? h('div', { style: { marginTop: '20px' } },
            areaChart(series.map((s) => ({ day: s.day, value: Number(s.total_value ?? s.total) })), { height: 150 }))
        : null,
    );
  } catch (error) {
    mount(host, errorState(error, { what: 'votre portefeuille' }));
  }
}

async function renderSplit(host) {
  try {
    const netWorth = await repo.getNetWorth();
    const buckets = [
      { label: 'Crypto', value: netWorth.crypto, color: 'var(--accent)', emoji: '₿' },
      { label: 'Liquidités', value: netWorth.cash, color: 'var(--accent-2)', emoji: '💶' },
      { label: 'Actions', value: netWorth.equity, color: 'var(--info)', emoji: '📈' },
      { label: 'Autres', value: netWorth.other, color: 'var(--neutral)', emoji: '📦' },
    ].filter((b) => b.value > 0);

    if (!buckets.length) {
      mount(host, emptyState({ emoji: '🥧', title: 'Rien à répartir pour l’instant' }));
      return;
    }

    const total = buckets.reduce((a, b) => a + b.value, 0);
    mount(host,
      bubbleChart(buckets),
      h('div.rows', { style: { marginTop: '8px' } },
        buckets.map((b) => h('div.row',
          h('div.avatar.avatar--dot', { style: { background: b.color } }),
          h('div.row__main', h('div.row__title', b.label)),
          h('div.row__end',
            h('div.row__value.sensitive', money(b.value, { decimals: 0 })),
            h('div.row__sub', `${Math.round((b.value / total) * 100)} %`),
          ),
        ))),
    );
  } catch (error) {
    mount(host, errorState(error, { what: 'la répartition' }));
  }
}

async function renderPositions(host) {
  try {
    const holdings = await repo.getHoldings();
    if (!holdings.length) {
      mount(host, emptyState({
        emoji: '📭',
        title: 'Aucune position',
        body: 'Connectez Kraken ou OKX depuis Profil, ou saisissez une position à la main.',
        action: h('button.btn.btn--primary', { type: 'button', onclick: () => openAddHolding() }, 'Ajouter une position'),
      }));
      return;
    }

    mount(host, h('div.rows', holdings.map((holding) => h('button.row', {
      type: 'button', 'data-sound': 'sheetOpen',
      onclick: () => openHolding(holding),
    },
      h('div.avatar', { style: { background: 'var(--surface-2)', fontWeight: '700', fontSize: '13px' } },
        holding.symbol?.slice(0, 3) ?? '?'),
      h('div.row__main',
        h('div.row__title', holding.name || holding.symbol),
        h('div.row__sub', `${num(holding.quantity)} ${holding.symbol}`),
      ),
      h('div.row__end',
        h('div.row__value.sensitive', money(holding.value)),
        Number.isFinite(holding.pnl_pct)
          ? h('div.row__sub', { class: trendClass(holding.pnl_pct) }, pct(holding.pnl_pct))
          : h('div.row__sub.unknown', 'prix de revient inconnu'),
      ),
    ))));
  } catch (error) {
    mount(host, errorState(error, { what: 'vos positions' }));
  }
}

function openHolding(holding) {
  openSheet({
    title: holding.name || holding.symbol,
    build: ({ close }) => h('div',
      bigAmount(holding.value, {
        label: `${num(holding.quantity)} ${holding.symbol}`,
        change: holding.pnl,
        changePct: holding.pnl_pct,
        changeLabel: 'depuis achat',
      }),

      h('div.rows', { style: { marginTop: '24px' } },
        detailRow('Prix actuel', money(holding.price)),
        detailRow('Prix de revient', holding.avg_cost ? money(holding.avg_cost) : '—'),
        detailRow('Investi', holding.cost === null ? '—' : money(holding.cost)),
        detailRow('Compte', holding.account?.label || holding.account_id),
        detailRow('Source', holding.source === 'sync' ? 'Synchronisé' : 'Saisi à la main'),
        detailRow('Dernière synchro', holding.synced_at ? fmtDay(holding.synced_at, { long: true }) : '—'),
      ),

      h('div', { style: { display: 'grid', gap: '10px', marginTop: '24px' } },
        h('button.btn.btn--secondary.btn--block', {
          type: 'button', 'data-sound': 'select',
          onclick: () => { close(); navigate(`/marches/${holding.asset_id}`); },
        }, `Voir le marché ${holding.symbol}`),
        holding.source !== 'sync'
          ? h('button.btn.btn--ghost.btn--block', {
              type: 'button',
              onclick: async () => {
                const ok = await confirmSheet({
                  title: 'Supprimer cette position ?',
                  message: 'Elle disparaîtra de votre portefeuille. Vos transactions bancaires ne sont pas touchées.',
                  confirmLabel: 'Supprimer', danger: true,
                });
                if (!ok) return;
                await repo.deleteHolding(holding.id);
                close();
                toast('Position supprimée');
                setTimeout(() => window.location.reload(), 400);
              },
            }, 'Supprimer')
          : null,
      ),
    ),
  });
}

function detailRow(label, value) {
  return h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, label)),
    h('div.row__end', h('div.row__value', value)),
  );
}

function renderAccounts(accounts, holdings = []) {
  // Un exchange détient des liquidités ET des positions. N'afficher que l'un
  // des deux donnait un compte à « — » alors qu'il pesait plusieurs milliers.
  const positionsByAccount = new Map();
  for (const holding of holdings) {
    const id = holding.account_id ?? holding.account?.id;
    if (!id || !Number.isFinite(holding.value)) continue;
    positionsByAccount.set(id, (positionsByAccount.get(id) ?? 0) + holding.value);
  }

  return h('div.rows', accounts.map((account) => h('div.row',
    h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } },
      ({ bank: '🏦', exchange: '🪙', broker: '📈', cash: '💶', manual: '✍️' })[account.kind] ?? '📦'),
    h('div.row__main',
      h('div.row__title', account.label),
      h('div.row__sub', account.iban_last4 ? `•••• ${account.iban_last4}` : account.provider),
    ),
    (() => {
      const positions = positionsByAccount.get(account.id) ?? 0;
      const cash = Number(account.balance);
      const hasCash = Number.isFinite(cash);
      const totalValue = (hasCash ? cash : 0) + positions;
      const known = hasCash || positions > 0;

      return h('div.row__end',
        known
          ? h('div.row__value.sensitive', money(totalValue))
          : h('div.row__value.unknown', '—'),
        positions > 0 && hasCash
          ? h('div.row__sub.muted-2', `dont ${money(positions)} en positions`)
          : (known
              ? h('div.row__sub', freshness(account.balance_at, { prefix: '', thresholdSeconds: 86400 }))
              : h('div.row__sub.muted-2', 'solde inconnu')),
      );
    })(),
  )));
}

async function renderBehaviour(host) {
  try {
    const [trades, assets] = await Promise.all([
      repo.getInvestmentTrades(),
      repo.listAssets(),
    ]);

    const btc = assets.find((a) => a.symbol === 'BTC') || assets[0];
    const history = btc ? await repo.getPriceHistory(btc.id, 1500) : [];
    const analysis = analyseBehaviour(trades, history);

    if (!analysis.available) {
      mount(host, h('div.notice',
        h('span', 'ℹ️'),
        h('div', h('strong', 'Pas encore assez d’achats'), analysis.reason)));
      return;
    }

    if (!analysis.observations.length) {
      mount(host, emptyState({
        emoji: '🔍', title: 'Rien de marquant',
        body: 'Vos achats ne montrent pas de motif particulier sur la période analysée.',
      }));
      return;
    }

    mount(host, h('div', { style: { display: 'grid', gap: '12px' } },
      analysis.observations.map((observation) => h('button.card.card--tap', {
        type: 'button', 'data-sound': 'sheetOpen',
        style: { textAlign: 'left', width: '100%' },
        onclick: () => openSheet({
          title: observation.title,
          build: () => h('div',
            h('p', observation.body),
            h('div.rows', { style: { marginTop: '20px' } },
              Object.entries(observation.evidence).map(([key, value]) =>
                detailRow(evidenceLabel(key), String(value)))),
            h('p.explain__source', { style: { marginTop: '20px' } }, analysis.disclaimer),
          ),
        }),
      },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
          h('span', { style: { fontSize: '20px' } },
            ({ success: '✅', warning: '⚠️', danger: '🔴' })[observation.severity] ?? '💡'),
          h('div',
            h('div', { style: { fontWeight: '600' } }, observation.title),
            h('div.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '2px' } }, observation.body),
          ),
        ),
      )),
      h('p.explain__source', analysis.disclaimer),
    ));
  } catch (error) {
    mount(host, errorState(error, { what: 'vos habitudes' }));
  }
}

const evidenceLabel = (key) => ({
  after_rally: 'Achats après une hausse',
  after_dip: 'Achats après une baisse',
  total: 'Achats analysés',
  median_prior_30d: 'Variation médiane des 30 jours précédents',
  best_median_drawdown: 'Drawdown médian des meilleurs achats',
  overall_median_drawdown: 'Drawdown médian de tous les achats',
  sample: 'Échantillon',
  median_gap_days: 'Écart médian entre deux achats',
  mean_deviation_days: 'Écart moyen à cette médiane',
  trades: 'Nombre d’achats',
  share_pct: 'Part du plus gros mois',
  months: 'Mois concernés',
}[key] ?? key);

/* — Ajout manuel d'une position ————————————————————— */

function openAddHolding() {
  openSheet({
    title: 'Ajouter une position',
    build: ({ close }) => {
      const symbol = h('input', { type: 'text', placeholder: 'BTC', required: true, autocapitalize: 'characters' });
      const quantity = h('input', { type: 'number', step: 'any', placeholder: '0,25', required: true, inputmode: 'decimal' });
      const cost = h('input', { type: 'number', step: 'any', placeholder: 'Prix de revient (optionnel)', inputmode: 'decimal' });
      const account = h('select');
      const error = h('div.field__error');

      repo.getAccounts().then((accounts) => {
        mount(account, accounts.map((a) => h('option', { value: a.id }, a.label)));
      });

      return h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          error.textContent = '';
          try {
            const assets = await repo.listAssets();
            const asset = assets.find((a) => a.symbol.toUpperCase() === symbol.value.trim().toUpperCase());
            if (!asset) {
              error.textContent = `« ${symbol.value} » ne fait pas partie des actifs suivis.`;
              return;
            }
            await repo.saveHolding({
              account_id: account.value,
              asset_id: asset.id,
              quantity: Number(quantity.value),
              avg_cost: cost.value ? Number(cost.value) : null,
              source: 'manual',
            });
            close();
            toast('Position ajoutée', { kind: 'success' });
            setTimeout(() => window.location.reload(), 400);
          } catch (e) {
            error.textContent = e.message;
          }
        },
      },
        h('div.field', h('label', 'Actif'), symbol,
          h('div.field__hint', 'Symbole, par exemple BTC ou SOL')),
        h('div.field', h('label', 'Quantité'), quantity),
        h('div.field', h('label', 'Prix de revient'), cost,
          h('div.field__hint', 'Laissez vide si vous ne le connaissez pas : WALLET affichera « inconnu » plutôt que d’inventer une plus-value.')),
        h('div.field', h('label', 'Compte'), account),
        error,
        h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select',
          style: { marginTop: '12px' } }, 'Ajouter'),
      );
    },
  });
}
