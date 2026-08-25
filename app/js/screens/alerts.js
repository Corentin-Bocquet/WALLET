/**
 * WALLET · Alertes (§32) et objectifs
 *
 * Les alertes sont évaluées côté serveur (Edge Function `alerts-run`) pour
 * fonctionner même application fermée. Cet écran sert à les définir et à
 * consulter ce qui s'est déclenché.
 */

import { h, mount } from '../lib/dom.js';
import { openSheet, confirmSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import {
  subScreenHead, section, loadingRows, emptyState, errorState, badge, switchRow,
} from '../components/ui.js';
import { money, pct, ago, day as fmtDay } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { ZONE_META } from '../engine/score.js';

const SUBJECTS = [
  { key: 'price', label: 'Prix d’un actif', emoji: '💰', needs: 'asset', unit: '€' },
  { key: 'score', label: 'Investment Score', emoji: '🎯', needs: 'asset', unit: '/100' },
  { key: 'zone', label: 'Changement de zone', emoji: '🚦', needs: 'asset', unit: '' },
  { key: 'net_worth', label: 'Patrimoine total', emoji: '📊', needs: null, unit: '€' },
  { key: 'category_spend', label: 'Dépense sur une catégorie', emoji: '🧾', needs: 'category', unit: '€' },
  { key: 'savings_rate', label: 'Taux d’épargne', emoji: '🏦', needs: null, unit: '%' },
  { key: 'anomaly', label: 'Dépense inhabituelle', emoji: '⚠️', needs: null, unit: '' },
];

const OPERATORS = [
  { key: 'gte', label: 'dépasse' },
  { key: 'lte', label: 'descend sous' },
  { key: 'crosses_up', label: 'franchit à la hausse' },
  { key: 'crosses_down', label: 'franchit à la baisse' },
  { key: 'changes', label: 'change' },
];

export async function alertsScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('Alertes', {
    right: h('button.icon-btn', {
      type: 'button', 'aria-label': 'Nouvelle alerte', 'data-sound': 'sheetOpen',
      onclick: () => editAlert(null, paint),
    }, '+'),
  }));

  const list = h('div');
  const events = h('div');
  screen.append(section('Mes alertes', {}, list), section('Historique', {}, events));

  mount(list, loadingRows(3));
  mount(events, loadingRows(2));

  async function paint() {
    try {
      const alerts = await repo.listAlerts();

      mount(list, alerts.length
        ? h('div.rows', alerts.map((alert) => h('button.row', {
            type: 'button', 'data-sound': 'sheetOpen',
            class: alert.is_active ? '' : 'row--ghost',
            onclick: () => editAlert(alert, paint),
          },
            h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } },
              SUBJECTS.find((s) => s.key === alert.subject)?.emoji ?? '🔔'),
            h('div.row__main',
              h('div.row__title', alert.label),
              h('div.row__sub', describeAlert(alert)),
            ),
            h('div.row__end',
              alert.is_active ? badge('active', 'accent') : badge('en pause'),
              alert.last_fired_at
                ? h('div.row__sub.muted-2', `déclenchée ${ago(alert.last_fired_at)}`)
                : null,
            ),
          )))
        : emptyState({
            emoji: '🔔',
            title: 'Aucune alerte',
            body: 'Créez une alerte pour être prévenu quand un prix, un score ou une dépense franchit un seuil.',
            action: h('button.btn.btn--primary', {
              type: 'button', onclick: () => editAlert(null, paint),
            }, 'Créer une alerte'),
          }));

      if (repo.isDemoMode()) {
        mount(events, h('div.notice',
          h('span', '🧪'),
          h('div', h('strong', 'Historique indisponible en démonstration'),
            'Les alertes sont évaluées par une fonction serveur : connectez votre serveur Supabase pour les activer réellement.')));
        return;
      }

      const history = await repo.listAlertEvents();
      mount(events, history.length
        ? h('div.rows', history.map((event) => h('div.row',
            h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } },
              ({ warning: '⚠️', danger: '🔴', success: '✅' })[event.severity] ?? '🔔'),
            h('div.row__main',
              h('div.row__title', event.title),
              h('div.row__sub', { style: { whiteSpace: 'normal' } }, event.body),
            ),
            h('div.row__end', h('div.row__sub', ago(event.created_at))),
          )))
        : emptyState({ emoji: '🤫', title: 'Rien ne s’est encore déclenché' }));

      repo.markAlertsRead().catch(() => {});
    } catch (error) {
      mount(list, errorState(error, { what: 'vos alertes', onRetry: paint }));
    }
  }

  await paint();
  return screen;
}

function describeAlert(alert) {
  const subject = SUBJECTS.find((s) => s.key === alert.subject);
  const operator = OPERATORS.find((o) => o.key === alert.operator);
  const target = alert.asset?.symbol || alert.category?.label || '';
  const threshold = alert.threshold !== null && alert.threshold !== undefined
    ? `${Number(alert.threshold)}${subject?.unit ?? ''}` : (alert.threshold_text ?? '');
  return `${target ? `${target} · ` : ''}${subject?.label ?? alert.subject} ${operator?.label ?? ''} ${threshold}`.trim();
}

function editAlert(alert, onChange) {
  openSheet({
    title: alert ? 'Modifier l’alerte' : 'Nouvelle alerte',
    build: ({ close }) => {
      const container = h('div');
      let subject = SUBJECTS.find((s) => s.key === alert?.subject) ?? SUBJECTS[0];

      const label = h('input', { type: 'text', value: alert?.label ?? '', required: true,
        placeholder: 'Ex. : BTC sous 60 000 €' });
      const operator = h('select', OPERATORS.map((o) =>
        h('option', { value: o.key, selected: alert?.operator === o.key }, o.label)));
      const threshold = h('input', { type: 'number', step: 'any', inputmode: 'decimal',
        value: alert?.threshold ?? '' });
      const cooldown = h('input', { type: 'number', min: '1', max: '168', inputmode: 'numeric',
        value: alert?.cooldown_hours ?? 24 });
      const targetField = h('div.field');
      const error = h('div.field__error');

      const subjectSelect = h('select', {
        onchange: () => {
          subject = SUBJECTS.find((s) => s.key === subjectSelect.value);
          paintTarget();
        },
      }, SUBJECTS.map((s) =>
        h('option', { value: s.key, selected: alert?.subject === s.key }, `${s.emoji} ${s.label}`)));

      let targetSelect = null;

      async function paintTarget() {
        if (!subject.needs) { mount(targetField, h('div')); targetSelect = null; return; }

        if (subject.needs === 'asset') {
          const assets = await repo.listAssets();
          targetSelect = h('select', assets.map((a) =>
            h('option', { value: a.id, selected: alert?.asset_id === a.id }, `${a.symbol} · ${a.name}`)));
          mount(targetField, h('label', 'Actif'), targetSelect);
        } else {
          const categories = await repo.listCategories();
          targetSelect = h('select', categories.map((c) =>
            h('option', { value: c.id, selected: alert?.category_id === c.id }, `${c.emoji} ${c.label}`)));
          mount(targetField, h('label', 'Catégorie'), targetSelect);
        }
      }

      paintTarget();

      mount(container,
        h('form', {
          onsubmit: async (event) => {
            event.preventDefault();
            error.textContent = '';
            try {
              await repo.saveAlert({
                ...(alert?.id ? { id: alert.id } : {}),
                label: label.value.trim(),
                subject: subject.key,
                operator: operator.value,
                threshold: threshold.value === '' ? null : Number(threshold.value),
                asset_id: subject.needs === 'asset' ? targetSelect?.value ?? null : null,
                category_id: subject.needs === 'category' ? targetSelect?.value ?? null : null,
                cooldown_hours: Number(cooldown.value) || 24,
                is_active: true,
              });
              close();
              toast('Alerte enregistrée', { kind: 'success' });
              onChange?.();
            } catch (e) {
              error.textContent = e.message;
            }
          },
        },
          h('div.field', h('label', 'Nom'), label),
          h('div.field', h('label', 'Surveiller'), subjectSelect),
          targetField,
          h('div.field', h('label', 'Condition'), operator),
          h('div.field', h('label', 'Seuil'), threshold,
            h('div.field__hint', 'Laissez vide pour les alertes qui ne dépendent pas d’un seuil.')),
          h('div.field', h('label', 'Ne pas répéter pendant (heures)'), cooldown,
            h('div.field__hint', 'Évite d’être notifié dix fois pour la même chose.')),
          error,
          h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
            'Enregistrer'),
        ),

        alert ? h('div', { style: { display: 'grid', gap: '10px', marginTop: '16px' } },
          h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: async () => {
              await repo.saveAlert({ ...alert, is_active: !alert.is_active });
              close();
              toast(alert.is_active ? 'Alerte mise en pause' : 'Alerte réactivée');
              onChange?.();
            },
          }, alert.is_active ? 'Mettre en pause' : 'Réactiver'),

          h('button.btn.btn--danger.btn--block', {
            type: 'button',
            onclick: async () => {
              const ok = await confirmSheet({
                title: 'Supprimer cette alerte ?', message: 'Elle ne se déclenchera plus.',
                confirmLabel: 'Supprimer', danger: true,
              });
              if (!ok) return;
              await repo.deleteAlert(alert.id);
              close();
              toast('Alerte supprimée');
              onChange?.();
            },
          }, 'Supprimer'),
        ) : null,

        repo.isDemoMode()
          ? h('div.notice.notice--warn', { style: { marginTop: '16px' } },
              h('span', '⚠️'),
              h('div', h('strong', 'Aucune notification en démonstration'),
                'Vos alertes sont enregistrées sur cet appareil, mais rien ne les évaluera tant que votre serveur Supabase n’est pas connecté.'))
          : null,
      );

      return container;
    },
  });
}

/* ================================================================== */
/* Objectifs                                                           */
/* ================================================================== */

const GOAL_KINDS = [
  { key: 'net_worth', label: 'Patrimoine total', emoji: '📊', unit: '€' },
  { key: 'savings_rate', label: 'Taux d’épargne mensuel', emoji: '🏦', unit: '%' },
  { key: 'cash_buffer', label: 'Épargne de précaution', emoji: '🛟', unit: '€' },
  { key: 'asset_quantity', label: 'Quantité d’un actif', emoji: '₿', unit: '' },
];

export async function goalsScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('Objectifs', {
    right: h('button.icon-btn', {
      type: 'button', 'aria-label': 'Nouvel objectif', 'data-sound': 'sheetOpen',
      onclick: () => editGoal(null, paint),
    }, '+'),
  }));

  const body = h('div');
  screen.append(body);
  mount(body, loadingRows(3));

  async function paint() {
    try {
      const [goals, netWorth, summary, holdings] = await Promise.all([
        repo.listGoals(),
        repo.getNetWorth().catch(() => null),
        repo.monthlySummary().catch(() => null),
        repo.getHoldings().catch(() => []),
      ]);

      if (!goals.length) {
        mount(body, emptyState({
          emoji: '🎯',
          title: 'Aucun objectif',
          body: 'Fixez une cible : WALLET vous montrera où vous en êtes, sans vous juger.',
          action: h('button.btn.btn--primary', {
            type: 'button', onclick: () => editGoal(null, paint),
          }, 'Créer un objectif'),
        }));
        return;
      }

      mount(body, h('div', { style: { display: 'grid', gap: '14px' } },
        goals.map((goal) => {
          const current = currentValue(goal, { netWorth, summary, holdings });
          const target = Number(goal.target_value);
          const known = Number.isFinite(current);
          const progress = known && target > 0 ? Math.min(100, (current / target) * 100) : null;
          const kind = GOAL_KINDS.find((k) => k.key === goal.kind);

          return h('button.card.card--tap', {
            type: 'button', 'data-sound': 'sheetOpen',
            style: { width: '100%', textAlign: 'left' },
            onclick: () => editGoal(goal, paint),
          },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } },
              h('div',
                h('div.eyebrow', `${goal.emoji ?? kind?.emoji ?? '🎯'} ${goal.label}`),
                h('div.num.sensitive', { style: { fontSize: '26px', fontWeight: '700', marginTop: '4px' } },
                  known
                    ? formatGoal(current, goal.kind)
                    : h('span.unknown', '—')),
                h('div.muted', { style: { fontSize: 'var(--fs-sm)' } },
                  `sur ${formatGoal(target, goal.kind)}`),
              ),
              progress !== null
                ? h('div.num', { style: { fontSize: '20px', fontWeight: '700',
                    color: progress >= 100 ? 'var(--accent)' : 'var(--text-2)' } },
                    `${Math.round(progress)} %`)
                : null,
            ),

            progress !== null
              ? h('div.meter', { style: { marginTop: '14px' } },
                  h('div.meter__fill', { style: { width: `${progress}%` } }))
              : h('p.muted-2', { style: { fontSize: 'var(--fs-sm)', marginTop: '10px' } },
                  'Progression inconnue : la donnée nécessaire n’est pas disponible.'),

            goal.target_date
              ? h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', marginTop: '8px' } },
                  `Échéance : ${fmtDay(goal.target_date, { long: true })}`)
              : null,
          );
        }),
      ));
    } catch (error) {
      mount(body, errorState(error, { what: 'vos objectifs', onRetry: paint }));
    }
  }

  await paint();
  return screen;
}

function currentValue(goal, { netWorth, summary, holdings }) {
  switch (goal.kind) {
    case 'net_worth': return netWorth?.total ?? NaN;
    case 'cash_buffer': return netWorth?.cash ?? NaN;
    case 'savings_rate':
      return summary?.savings_rate === null || summary?.savings_rate === undefined
        ? NaN : Number(summary.savings_rate);
    case 'asset_quantity': {
      const holding = holdings.find((hold) => hold.asset_id === goal.asset_id);
      return holding ? Number(holding.quantity) : NaN;
    }
    default: return NaN;
  }
}

function formatGoal(value, kind) {
  if (!Number.isFinite(value)) return '—';
  if (kind === 'savings_rate') return `${Math.round(value)} %`;
  if (kind === 'asset_quantity') return String(Math.round(value * 1e6) / 1e6);
  return money(value, { decimals: 0 });
}

function editGoal(goal, onChange) {
  openSheet({
    title: goal ? 'Modifier l’objectif' : 'Nouvel objectif',
    build: ({ close }) => {
      const label = h('input', { type: 'text', value: goal?.label ?? '', required: true,
        placeholder: 'Ex. : 100 000 € de patrimoine' });
      const kind = h('select', GOAL_KINDS.map((k) =>
        h('option', { value: k.key, selected: goal?.kind === k.key }, `${k.emoji} ${k.label}`)));
      const target = h('input', { type: 'number', step: 'any', required: true,
        inputmode: 'decimal', value: goal?.target_value ?? '' });
      const date = h('input', { type: 'date', value: goal?.target_date ?? '' });
      const error = h('div.field__error');

      return h('div',
        h('form', {
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await repo.saveGoal({
                ...(goal?.id ? { id: goal.id } : {}),
                label: label.value.trim(),
                kind: kind.value,
                target_value: Number(target.value),
                target_date: date.value || null,
                emoji: GOAL_KINDS.find((k) => k.key === kind.value)?.emoji ?? '🎯',
              });
              close();
              toast('Objectif enregistré', { kind: 'success' });
              onChange?.();
            } catch (e) { error.textContent = e.message; }
          },
        },
          h('div.field', h('label', 'Nom'), label),
          h('div.field', h('label', 'Type'), kind),
          h('div.field', h('label', 'Cible'), target),
          h('div.field', h('label', 'Échéance (optionnelle)'), date),
          error,
          h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
            'Enregistrer'),
        ),

        goal ? h('button.btn.btn--danger.btn--block', {
          type: 'button', style: { marginTop: '12px' },
          onclick: async () => {
            const ok = await confirmSheet({
              title: 'Supprimer cet objectif ?', message: 'Il disparaîtra de votre liste.',
              confirmLabel: 'Supprimer', danger: true,
            });
            if (!ok) return;
            await repo.deleteGoal(goal.id);
            close();
            toast('Objectif supprimé');
            onChange?.();
          },
        }, 'Supprimer') : null,
      );
    },
  });
}
