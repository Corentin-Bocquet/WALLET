/**
 * WALLET · Banque — dépenses, catégorisation, apprentissage
 *
 * C'est ici que se joue le cœur du cahier des charges (§8 à §20).
 * Chaque transaction expose :
 *   · sa catégorie ET la raison de cette catégorie (§47)
 *   · son niveau de confiance (§15)
 *   · un moyen de corriger en deux taps, qui fait apprendre WALLET (§10)
 */

import { h, mount, icon } from '../lib/dom.js';
import { navigate, parseHash } from '../lib/router.js';
import { openSheet, confirmSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import { feedback } from '../lib/feedback.js';
import {
  screenHead, subScreenHead, section, loadingRows, loadingBlock, emptyState,
  errorState, badge, seeAll, switchRow, asyncBlock,
} from '../components/ui.js';
import { explainChip, labelWithInfo } from '../components/explain.js';
import { bubbleChart, barList } from '../components/chart.js';
import { money, pct, day as fmtDay, month as fmtMonth, titleCase, trendClass } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { BUCKET_LABEL } from '../engine/normalize.js';
import { selectSimilarTransactions } from '../engine/categorizer.js';
import { CADENCE_LABEL, monthlyRecurringCost } from '../engine/recurring.js';

/* ================================================================== */
/* Écran principal                                                     */
/* ================================================================== */

export async function bankingScreen() {
  const screen = h('main.screen');
  const { query } = parseHash();

  let monthOffset = 0;
  let categoryFilter = query.categorie || null;

  screen.append(subScreenHead('Mes dépenses', {
    right: h('button.icon-btn', {
      type: 'button', 'aria-label': 'Règles et mémoire', 'data-sound': 'select',
      onclick: () => navigate('/banque/regles'),
    }, '⚙'),
  }));

  /* Sélecteur de mois, comme sur l'écran de référence */
  const monthPicker = h('div.hscroll', { style: { marginBottom: '20px' } });
  const body = h('div');
  screen.append(monthPicker, body);

  const paintMonths = () => {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      return { offset: -i, date: d, label: fmtMonth(d) };
    }).reverse();

    mount(monthPicker, months.map((m) => h('button', {
      type: 'button', 'data-sound': 'select',
      'aria-current': m.offset === monthOffset ? 'true' : null,
      style: {
        padding: '8px 14px', borderRadius: 'var(--r-pill)', whiteSpace: 'nowrap',
        fontWeight: m.offset === monthOffset ? '700' : '500',
        color: m.offset === monthOffset ? 'var(--text)' : 'var(--text-3)',
        background: m.offset === monthOffset ? 'var(--surface)' : 'transparent',
      },
      onclick: (event) => {
        monthOffset = m.offset;
        paintMonths();
        paint();
        event.currentTarget.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      },
    }, m.label)));

    // Après le layout, pas avant : queueMicrotask s'exécute alors que les
    // largeurs ne sont pas encore connues et le défilement retombe à zéro.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = monthPicker.querySelector('[aria-current]');
      if (!active) return;
      monthPicker.scrollLeft = active.offsetLeft
        - (monthPicker.clientWidth - active.clientWidth) / 2;
    }));
  };

  const monthKey = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1))
      .toISOString().slice(0, 10);
  };

  async function paint() {
    mount(body, loadingBlock(320));
    try {
      const month = monthKey();
      const [summary, breakdown, categories] = await Promise.all([
        repo.monthlySummary(month),
        repo.categoryBreakdown(month, 'expense'),
        repo.listCategories(),
      ]);

      const from = month;
      const to = new Date(Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + 1, 0))
        .toISOString().slice(0, 10);

      const transactions = await repo.listTransactions({
        from, to, categoryId: categoryFilter, status: 'all', limit: 500,
      });

      mount(body,
        summaryCard(summary),
        toClassifyBanner(transactions),

        section('Répartition', {
          action: categoryFilter
            ? h('button.btn.btn--ghost.btn--sm', {
                type: 'button', onclick: () => { categoryFilter = null; paint(); },
              }, '✕ Filtre')
            : null,
        },
          breakdown.length
            ? h('div',
                bubbleChart(breakdown.slice(0, 5), {
                  onSelect: (item) => { categoryFilter = item.category_id; paint(); },
                }),
                h('div', { style: { marginTop: '12px' } },
                  barList(breakdown, {
                    onSelect: (item) => { categoryFilter = item.category_id; paint(); },
                  })),
              )
            : emptyState({ emoji: '🧾', title: 'Aucune dépense ce mois-ci' }),
        ),

        section(categoryFilter
          ? `Transactions · ${categories.find((c) => c.id === categoryFilter)?.label ?? ''}`
          : 'Toutes les transactions', {},
          transactionList(transactions, categories, paint),
        ),
      );
    } catch (error) {
      mount(body, errorState(error, { what: 'vos transactions', onRetry: paint }));
    }
  }

  paintMonths();
  await paint();
  return screen;
}

function summaryCard(summary) {
  if (!summary) return h('div');

  const expense = Number(summary.expense);
  const income = Number(summary.income);
  const invested = Number(summary.invested ?? 0);
  const rate = summary.savings_rate === null ? null : Number(summary.savings_rate);

  return h('div.card',
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' } },
      figure('💳 Dépenses', money(expense, { decimals: 0 })),
      figure('💶 Revenus', income > 0 ? money(income, { decimals: 0 }) : h('span.unknown', '—')),
      invested > 0 ? figure('📊 Investi', money(invested, { decimals: 0 })) : null,
      figure(
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          '🏦 Épargne', explainChip('savings_rate', { label: "taux d'épargne" })),
        rate === null ? h('span.unknown', '—') : `${Math.round(rate)} %`,
        rate === null ? 'revenus inconnus' : money(Number(summary.net_savings), { decimals: 0 }),
      ),
    ),
  );
}

function figure(label, value, sub) {
  return h('div',
    h('div.eyebrow', { style: { fontSize: 'var(--fs-sm)' } }, label),
    h('div.num.sensitive', { style: { fontSize: '24px', fontWeight: '700', marginTop: '2px' } }, value),
    sub ? h('div.muted-2', { style: { fontSize: 'var(--fs-xs)' } }, sub) : null,
  );
}

function toClassifyBanner(transactions) {
  const pending = transactions.filter((t) => t.needsConfirmation && t.status === 'active');
  if (!pending.length) return h('div');

  return h('button.card.card--tap', {
    type: 'button', 'data-sound': 'select',
    style: { marginTop: '16px', width: '100%', textAlign: 'left',
      background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))' },
    onclick: () => navigate('/banque/a-classer'),
  },
    h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
      h('span', { style: { fontSize: '22px' } }, '❓'),
      h('div',
        h('div', { style: { fontWeight: '600' } }, `${pending.length} transactions à classer`),
        h('div.muted', { style: { fontSize: 'var(--fs-sm)' } },
          'WALLET hésite. Dites-lui une fois, il retiendra.'),
      ),
      h('span', { style: { marginLeft: 'auto', color: 'var(--text-3)' } }, '›'),
    ),
  );
}

/* ================================================================== */
/* Liste de transactions                                               */
/* ================================================================== */

export function transactionList(transactions, categories, onChange) {
  const visible = transactions.filter((t) => t.status !== 'hidden');

  if (!visible.length) {
    return emptyState({ emoji: '🧾', title: 'Aucune transaction', body: 'Rien sur cette période.' });
  }

  const byDay = new Map();
  for (const tx of visible) {
    if (!byDay.has(tx.booked_at)) byDay.set(tx.booked_at, []);
    byDay.get(tx.booked_at).push(tx);
  }

  return h('div',
    [...byDay.entries()].map(([date, rows]) => h('div', { style: { marginTop: '20px' } },
      h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', fontWeight: '600',
        textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '4px' } },
        fmtDay(date, { long: true })),
      h('div.rows', rows.map((tx) => transactionRow(tx, categories, onChange))),
    )),
  );
}

export function transactionRow(tx, categories, onChange) {
  const ignored = tx.status === 'ignored';

  return h(`button.row${ignored ? '.row--ghost' : ''}`, {
    type: 'button', 'data-sound': 'sheetOpen',
    onclick: () => openTransaction(tx, categories, onChange),
  },
    h('div.avatar', {
      style: { background: 'var(--surface-2)', fontSize: '18px' },
    }, tx.emoji || '❓'),

    h('div.row__main',
      h('div.row__title', titleCase(tx.merchant || tx.clean_label) || tx.raw_label),
      h('div.row__sub',
        tx.category_label || 'Non classé',
        tx.needsConfirmation ? h('span', { style: { color: 'var(--warn)' } }, ' · à confirmer') : null,
        ignored ? h('span', ' · ignorée') : null,
        tx.is_anomaly ? h('span', { style: { color: 'var(--warn)' } }, ' · inhabituelle') : null,
      ),
    ),

    h('div.row__end',
      h('div.row__value.sensitive', {
        class: tx.amount > 0 ? 'up' : '',
      }, money(tx.amount, { sign: tx.amount > 0 })),
      confidenceDot(tx),
    ),
  );
}

function confidenceDot(tx) {
  const confidence = Number(tx.category_confidence ?? 0);
  if (tx.category_source === 'user') {
    return h('div.row__sub', { style: { color: 'var(--accent)' } }, 'votre choix');
  }
  if (confidence >= 0.85) return h('div.row__sub.muted-2', `${Math.round(confidence * 100)} %`);
  if (confidence >= 0.6) return h('div.row__sub', { style: { color: 'var(--text-3)' } }, `${Math.round(confidence * 100)} %`);
  return h('div.row__sub', { style: { color: 'var(--warn)' } }, `${Math.round(confidence * 100)} %`);
}

/* ================================================================== */
/* Fiche transaction : corriger et comprendre                          */
/* ================================================================== */

export function openTransaction(tx, categories, onChange) {
  openSheet({
    title: titleCase(tx.merchant || tx.clean_label) || tx.raw_label,
    build: ({ close }) => {
      const container = h('div');

      const paint = () => mount(container,
        h('div.display.num.sensitive', {
          style: { fontSize: '34px' },
          class: tx.amount > 0 ? 'up' : '',
        }, money(tx.amount, { sign: tx.amount > 0 })),

        h('div.muted', { style: { marginTop: '4px' } },
          fmtDay(tx.booked_at, { long: true }),
          tx.operation_type ? ` · ${tx.operation_type}` : null),

        /* Catégorie actuelle + raison (§47) */
        h('div.card', { style: { marginTop: '24px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
            h('span', { style: { fontSize: '24px' } }, tx.emoji || '❓'),
            h('div', { style: { flex: '1' } },
              h('div', { style: { fontWeight: '700' } }, tx.category_label || 'Non classé'),
              h('div.muted', { style: { fontSize: 'var(--fs-sm)' } },
                `Confiance ${Math.round(Number(tx.category_confidence ?? 0) * 100)} %`,
                explainChip('confidence', { label: 'confiance' })),
            ),
          ),

          tx.category_reason?.label
            ? h('div', { style: { marginTop: '14px', paddingTop: '14px',
                borderTop: '1px solid var(--hairline)' } },
                h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', fontWeight: '600',
                  textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Pourquoi cette catégorie'),
                h('div', { style: { marginTop: '6px', fontWeight: '500' } }, tx.category_reason.label),
                tx.category_reason.detail
                  ? h('div.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '4px' } },
                      tx.category_reason.detail)
                  : null,
              )
            : null,
        ),

        /* Anomalie */
        tx.anomaly
          ? h('div.notice.notice--warn', { style: { marginTop: '14px' } },
              h('span', '⚠️'),
              h('div', h('strong', 'Dépense inhabituelle', explainChip('anomaly', { label: 'anomalie' })),
                tx.anomaly.explanation))
          : null,

        /* Suggestion d'exclusion apprise (§13) */
        tx.suggestIgnore
          ? h('div.notice', { style: { marginTop: '14px' } },
              h('span', '💡'),
              h('div',
                h('strong', tx.suggestIgnore.label),
                tx.suggestIgnore.detail,
                h('div', { style: { marginTop: '10px' } },
                  h('button.btn.btn--sm.btn--secondary', {
                    type: 'button',
                    onclick: () => changeStatus(tx, 'ignored', close, onChange),
                  }, 'Exclure celle-ci'))))
          : null,

        /* Corriger */
        h('div', { style: { marginTop: '24px' } },
          h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', fontWeight: '600',
            textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '10px' } },
            'Changer de catégorie'),

          tx.alternatives?.length
            ? h('div.hscroll', { style: { marginBottom: '10px' } },
                tx.alternatives.map((c) => quickCategory(c, tx, close, onChange)))
            : null,

          h('button.btn.btn--secondary.btn--block', {
            type: 'button', 'data-sound': 'sheetOpen',
            onclick: () => pickCategory(tx, categories, close, onChange),
          }, 'Toutes les catégories'),
        ),

        /* Autres actions */
        h('div', { style: { display: 'grid', gap: '10px', marginTop: '20px' } },
          h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: () => changeStatus(tx, tx.status === 'ignored' ? 'active' : 'ignored', close, onChange),
          }, tx.status === 'ignored'
            ? 'Réintégrer dans mes analyses'
            : 'Exclure de mes analyses'),

          h('button.btn.btn--ghost.btn--block', {
            type: 'button', 'data-sound': 'sheetOpen',
            onclick: () => createRuleFrom(tx, categories, close, onChange),
          }, 'Créer une règle pour ce marchand'),
        ),

        h('p.explain__source', { style: { marginTop: '20px' } },
          'Libellé brut : ', h('code', tx.raw_label)),
        h('p.explain__source',
          'Une transaction n’est jamais supprimée. Exclure la retire des analyses, elle reste dans votre historique.'),
      );

      paint();
      return container;
    },
  });
}

function quickCategory(category, tx, close, onChange) {
  return h('button.badge', {
    type: 'button', 'data-sound': 'success',
    style: { padding: '10px 14px', fontSize: 'var(--fs-sm)', fontWeight: '600' },
    onclick: () => correct(tx, category, close, onChange),
  }, `${category.emoji} ${category.label}`);
}

function pickCategory(tx, categories, closeParent, onChange) {
  openSheet({
    title: 'Choisir une catégorie',
    build: ({ close }) => {
      const groups = [
        ['Dépenses', categories.filter((c) => c.kind === 'expense')],
        ['Revenus', categories.filter((c) => c.kind === 'income')],
        ['Investissement', categories.filter((c) => c.kind === 'investment')],
        ['Transferts', categories.filter((c) => c.kind === 'transfer')],
      ];

      return h('div',
        groups.filter(([, list]) => list.length).map(([title, list]) => h('div', { style: { marginTop: '16px' } },
          h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', fontWeight: '600',
            textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' } }, title),
          h('div.rows', list.map((category) => h('button.row', {
            type: 'button', 'data-sound': 'success',
            onclick: () => { close(); correct(tx, category, closeParent, onChange); },
          },
            h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } }, category.emoji),
            h('div.row__main', h('div.row__title', category.label)),
            h('div.row__end',
              category.id === tx.category_id ? h('span', { style: { color: 'var(--accent)' } }, '✓') : null),
          ))),
        )),
      );
    },
  });
}

/**
 * LE geste central. Après la correction, on propose d'appliquer aux
 * transactions similaires — proposé, jamais imposé.
 */
async function correct(tx, category, close, onChange) {
  try {
    const result = await repo.applyCategoryCorrection(tx.id, category.id, false);
    feedback.success();
    close();

    toast(`Classé en ${category.label}. WALLET s'en souviendra.`, { kind: 'success' });
    onChange?.();

    // Proposition différée : on ne bloque pas le geste principal.
    setTimeout(() => proposeSimilar(tx, category, result, onChange), 500);
  } catch (error) {
    toast(`Impossible d'enregistrer : ${error.message}`, { kind: 'error' });
  }
}

async function proposeSimilar(tx, category, result, onChange) {
  const key = result?.key || tx.merchant || tx.clean_label;
  const bucket = result?.bucket;

  const similar = await repo.listTransactions({ status: 'all', limit: 500 })
    .then((rows) => selectSimilarTransactions(rows, {
      excludeId: tx.id, key, bucket, categoryId: category.id,
    }))
    .catch(() => []);

  if (!similar.length) return;

  openSheet({
    title: 'Appliquer aux autres ?',
    build: ({ close }) => h('div',
      h('p', `${similar.length} autres transactions « ${key} » ne sont pas encore classées en ${category.label}.`),
      bucket
        ? h('p.muted', { style: { fontSize: 'var(--fs-sm)', marginTop: '10px' } },
            `WALLET a retenu votre choix pour les montants ${BUCKET_LABEL[bucket]}. Les montants très différents resteront traités séparément — un Amazon à 12 € et un Amazon à 480 €, ce n'est souvent pas la même chose.`)
        : null,

      h('div.rows', { style: { marginTop: '16px', maxHeight: '30vh', overflowY: 'auto' } },
        similar.slice(0, 8).map((t) => h('div.row',
          h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '16px' } }, t.emoji || '❓'),
          h('div.row__main',
            h('div.row__title', fmtDay(t.booked_at)),
            h('div.row__sub', t.category_label || 'Non classé'),
          ),
          h('div.row__end', h('div.row__value', money(t.amount))),
        ))),

      h('div', { style: { display: 'grid', gap: '10px', marginTop: '20px' } },
        h('button.btn.btn--primary.btn--block', {
          type: 'button', 'data-sound': 'success',
          onclick: async () => {
            let done = 0;
            for (const t of similar) {
              try { await repo.applyCategoryCorrection(t.id, category.id, false); done += 1; }
              catch { /* on continue : un échec ne doit pas tout annuler */ }
            }
            close();
            toast(`${done} transactions reclassées`, { kind: 'success' });
            onChange?.();
          },
        }, `Oui, appliquer aux ${similar.length}`),
        h('button.btn.btn--ghost.btn--block', { type: 'button', onclick: () => close() },
          'Non, seulement celle-ci'),
      ),
    ),
  });
}

async function changeStatus(tx, status, close, onChange) {
  try {
    await repo.setTransactionStatus(tx.id, status);
    close();
    toast(status === 'ignored'
      ? 'Exclue de vos analyses. Elle reste dans votre historique.'
      : 'Réintégrée dans vos analyses');
    onChange?.();
  } catch (error) {
    toast(error.message, { kind: 'error' });
  }
}

function createRuleFrom(tx, categories, closeParent, onChange) {
  openSheet({
    title: 'Nouvelle règle',
    build: ({ close }) => {
      const pattern = h('input', { type: 'text', value: tx.merchant || tx.clean_label, required: true });
      const select = h('select', categories.map((c) =>
        h('option', { value: c.id, selected: c.id === tx.category_id }, `${c.emoji} ${c.label}`)));
      const sign = h('select',
        h('option', { value: '' }, 'Peu importe'),
        h('option', { value: 'debit', selected: tx.amount < 0 }, 'Dépenses seulement'),
        h('option', { value: 'credit', selected: tx.amount > 0 }, 'Revenus seulement'));

      return h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            await repo.createRule({
              category_id: select.value,
              match_type: 'contains',
              pattern: pattern.value.trim().toLowerCase(),
              sign: sign.value || null,
              priority: 200,
            });
            close();
            closeParent?.();
            toast('Règle créée. Elle s’applique désormais en priorité.', { kind: 'success' });
            onChange?.();
          } catch (error) {
            toast(error.message, { kind: 'error' });
          }
        },
      },
        h('p.muted', { style: { fontSize: 'var(--fs-sm)' } },
          'Une règle bat tout le reste : elle passe avant la mémoire et avant les déductions automatiques.'),
        h('div.field', { style: { marginTop: '16px' } },
          h('label', 'Si le libellé contient'), pattern),
        h('div.field', h('label', 'Alors classer en'), select),
        h('div.field', h('label', 'Appliquer à'), sign),
        h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
          'Créer la règle'),
      );
    },
  });
}

/* ================================================================== */
/* Écran « À classer » : la file d'attente (§15)                       */
/* ================================================================== */

export async function toClassifyScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('À classer'));

  const body = h('div');
  screen.append(body);
  mount(body, loadingRows(5));

  async function paint() {
    try {
      const [transactions, categories] = await Promise.all([
        repo.listTransactions({ status: 'active', limit: 500 }),
        repo.listCategories(),
      ]);

      const pending = transactions.filter((t) => t.needsConfirmation);

      if (!pending.length) {
        mount(body, emptyState({
          emoji: '🎉',
          title: 'Tout est classé',
          body: 'WALLET sait quoi faire de chacune de vos transactions.',
          action: h('button.btn.btn--secondary', { type: 'button', onclick: () => navigate('/banque') },
            'Retour aux dépenses'),
        }));
        return;
      }

      mount(body,
        h('p.muted', { style: { marginBottom: '20px' } },
          `${pending.length} transactions dont WALLET n'est pas sûr. Chaque réponse lui apprend quelque chose.`),
        h('div.rows', pending.map((tx) => transactionRow(tx, categories, paint))),
      );
    } catch (error) {
      mount(body, errorState(error, { what: 'la file à classer', onRetry: paint }));
    }
  }

  await paint();
  return screen;
}

/* ================================================================== */
/* Écran « Récurrent » (§19)                                           */
/* ================================================================== */

export async function recurringScreen() {
  const screen = h('main.screen');

  screen.append(subScreenHead('Paiements récurrents', {
    right: h('button.icon-btn', {
      type: 'button', 'aria-label': 'Recalculer', 'data-sound': 'select',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.textContent = '…';
        button.disabled = true;
        try {
          await repo.refreshRecurring();
          toast('Récurrences recalculées', { kind: 'success' });
          setTimeout(() => window.location.reload(), 500);
        } catch (error) {
          toast(error.message, { kind: 'error' });
          button.textContent = '⟳';
          button.disabled = false;
        }
      },
    }, '⟳'),
  }));

  const body = h('div');
  screen.append(body);
  mount(body, loadingRows(5));

  try {
    const recurring = await repo.listRecurring();
    const debits = recurring.filter((r) => r.direction !== 'credit');
    const credits = recurring.filter((r) => r.direction === 'credit');

    if (!recurring.length) {
      mount(body, emptyState({
        emoji: '🔄',
        title: 'Aucun paiement récurrent détecté',
        body: 'Il faut au moins trois passages réguliers pour qu’un prélèvement soit reconnu.',
      }));
      return screen;
    }

    const monthly = monthlyRecurringCost(debits);

    mount(body,
      h('div.card',
        h('div.eyebrow', 'Coût mensuel de vos abonnements'),
        h('div.display.num.sensitive', { style: { fontSize: '32px', marginTop: '4px' } },
          money(monthly, { decimals: 0 })),
        h('div.muted', { style: { fontSize: 'var(--fs-sm)' } },
          `soit ${money(monthly * 12, { decimals: 0 })} par an · ${debits.filter((r) => r.is_active).length} actifs`),
        h('p.explain__source', { style: { marginTop: '12px' } },
          'Les cadences non mensuelles sont ramenées à une base mensuelle pour permettre la comparaison.'),
      ),

      debits.length ? section('Sorties régulières', {}, recurringList(debits)) : null,
      credits.length ? section('Entrées régulières', {}, recurringList(credits)) : null,
    );
  } catch (error) {
    mount(body, errorState(error, { what: 'vos récurrences' }));
  }

  return screen;
}

function recurringList(items) {
  return h('div.rows', items.map((r) => h('button.row', {
    type: 'button', 'data-sound': 'sheetOpen',
    class: r.is_active ? '' : 'row--ghost',
    onclick: () => openSheet({
      title: r.label,
      build: () => h('div',
        h('div.display.num.sensitive', { style: { fontSize: '30px' } },
          money(Number(r.average_amount))),
        h('div.muted', CADENCE_LABEL[r.cadence] ?? r.cadence),

        h('div.rows', { style: { marginTop: '24px' } },
          line('Cadence', CADENCE_LABEL[r.cadence] ?? r.cadence),
          line('Occurrences', String(r.occurrences)),
          line('Premier passage', fmtDay(r.first_seen, { long: true })),
          line('Dernier passage', fmtDay(r.last_seen, { long: true })),
          line('Prochain attendu', r.next_expected ? fmtDay(r.next_expected, { long: true }) : '—'),
          line('Variation des montants', money(Number(r.amount_variance))),
          line('Confiance de détection', `${Math.round(Number(r.confidence) * 100)} %`),
          line('Statut', r.is_active ? 'Actif' : 'Semble arrêté'),
        ),

        h('p.explain__source', { style: { marginTop: '20px' } },
          'La cadence est déduite de la médiane des intervalles entre passages. Un abonnement dont le dernier passage remonte à plus de deux périodes est considéré comme arrêté.'),
      ),
    }),
  },
    h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } },
      ({ subscription: '🔄', rent: '🏠', salary: '💼', loan: '🏦', insurance: '🛡️', transfer: '🔁' })[r.kind] ?? '🔄'),
    h('div.row__main',
      h('div.row__title', r.label),
      h('div.row__sub', `${CADENCE_LABEL[r.cadence] ?? r.cadence}${r.is_active ? '' : ' · arrêté ?'}`),
    ),
    h('div.row__end',
      h('div.row__value.sensitive', money(Number(r.average_amount))),
      h('div.row__sub.muted-2', `${Math.round(Number(r.confidence) * 100)} %`),
    ),
  )));
}

function line(label, value) {
  return h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, label)),
    h('div.row__end', h('div.row__value', value)),
  );
}

/* ================================================================== */
/* Écran « Règles et mémoire » (§16, §17)                              */
/* ================================================================== */

export async function rulesScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('Règles et mémoire'));

  const rulesHost = h('div');
  const memoryHost = h('div');

  screen.append(
    h('p.muted', { style: { marginBottom: '8px' } },
      'WALLET décide dans cet ordre : vos règles d’abord, puis ce qu’il a appris de vos corrections, puis ses déductions.'),
    section('Mes règles', {}, rulesHost),
    section('Ce que WALLET a appris', { explain: 'confidence' }, memoryHost),
  );

  mount(rulesHost, loadingRows(3));
  mount(memoryHost, loadingRows(4));

  async function paintRules() {
    try {
      const [rules, categories] = await Promise.all([repo.listRules(), repo.listCategories()]);
      const byId = new Map(categories.map((c) => [c.id, c]));

      if (!rules.length) {
        mount(rulesHost, emptyState({
          emoji: '📏',
          title: 'Aucune règle',
          body: 'Créez-en une depuis n’importe quelle transaction : « Créer une règle pour ce marchand ».',
        }));
        return;
      }

      mount(rulesHost, h('div.rows', rules.map((rule) => {
        const category = rule.category || byId.get(rule.category_id);
        return h('div.row',
          h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } },
            category?.emoji ?? '❓'),
          h('div.row__main',
            h('div.row__title', `« ${rule.pattern} »`),
            h('div.row__sub', `→ ${category?.label ?? '—'}${rule.sign === 'debit' ? ' · dépenses' : rule.sign === 'credit' ? ' · revenus' : ''}`),
          ),
          h('div.row__end',
            h('button.btn.btn--sm.btn--ghost', {
              type: 'button', 'data-sound': 'warn',
              onclick: async () => {
                const ok = await confirmSheet({
                  title: 'Supprimer cette règle ?',
                  message: `Les transactions « ${rule.pattern} » repasseront par la mémoire et les déductions automatiques.`,
                  confirmLabel: 'Supprimer', danger: true,
                });
                if (!ok) return;
                await repo.deleteRule(rule.id);
                toast('Règle supprimée');
                paintRules();
              },
            }, 'Supprimer'),
          ),
        );
      })));
    } catch (error) {
      mount(rulesHost, errorState(error, { what: 'vos règles', onRetry: paintRules }));
    }
  }

  async function paintMemory() {
    try {
      const [memory, categories] = await Promise.all([repo.listMemory(), repo.listCategories()]);
      const byId = new Map(categories.map((c) => [c.id, c]));

      if (!memory.length) {
        mount(memoryHost, emptyState({
          emoji: '🧠',
          title: 'WALLET n’a encore rien appris',
          body: 'Corrigez la catégorie d’une transaction : il retiendra votre choix et l’appliquera aux suivantes.',
        }));
        return;
      }

      mount(memoryHost, h('div.rows', memory.slice(0, 40).map((entry) => {
        const category = entry.category || byId.get(entry.category_id);
        return h('div.row',
          h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } },
            category?.emoji ?? '❓'),
          h('div.row__main',
            h('div.row__title', titleCase(entry.key_value)),
            h('div.row__sub',
              `→ ${category?.label ?? '—'} · ${entry.amount_bucket === 'any' ? 'tous montants' : BUCKET_LABEL[entry.amount_bucket]}`),
          ),
          h('div.row__end',
            h('div.row__value', `${entry.hits}×`),
            h('button.btn.btn--sm.btn--ghost', {
              type: 'button', 'data-sound': 'warn',
              style: { padding: '0 8px', minHeight: '28px' },
              onclick: async () => {
                const ok = await confirmSheet({
                  title: 'Oublier cet apprentissage ?',
                  message: `WALLET ne se souviendra plus que « ${entry.key_value} » va dans ${category?.label ?? 'cette catégorie'}.`,
                  confirmLabel: 'Oublier', danger: true,
                });
                if (!ok) return;
                await repo.forgetMemory(entry.key_value, entry.amount_bucket);
                toast('Oublié');
                paintMemory();
              },
            }, 'Oublier'),
          ),
        );
      })));
    } catch (error) {
      mount(memoryHost, errorState(error, { what: 'la mémoire', onRetry: paintMemory }));
    }
  }

  await Promise.all([paintRules(), paintMemory()]);
  return screen;
}
