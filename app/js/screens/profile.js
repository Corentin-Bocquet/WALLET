/**
 * WALLET · Profil — « Comment configurer mon application ? » (§34, §35)
 *
 * Deux niveaux, comme demandé : les réglages simples sont visibles, les
 * réglages avancés sont derrière une porte. Rien d'important n'est
 * inaccessible, rien de complexe n'est imposé.
 */

import { h, mount, icon } from '../lib/dom.js';
import { glyph } from '../components/icons.js';
import { navigate } from '../lib/router.js';
import { openSheet, confirmSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import { setFeedbackPrefs } from '../lib/feedback.js';
import {
  screenHead, subScreenHead, section, loadingRows, loadingBlock, emptyState,
  errorState, switchRow, badge, accordion, asyncBlock,
} from '../components/ui.js';
import { explainChip } from '../components/explain.js';
import { money, initials, day as fmtDay, ago } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { SUPPORTED, displayCurrency, setDisplayCurrency } from '../lib/currency.js';
import { config, saveConfig } from '../config.js';
import { openServerSheet } from './auth.js';
import { DEFAULT_WEIGHTS, DEFAULT_ZONES, FACTOR_LABELS, FACTOR_HELP, ZONE_META } from '../engine/score.js';
import { applyTheme } from '../lib/theme.js';

/* ================================================================== */
/* Écran principal                                                     */
/* ================================================================== */

export async function profileScreen() {
  const screen = h('main.screen');
  screen.append(screenHead('Profil'));

  const [profile, settings] = await Promise.all([
    repo.getProfile().catch(() => null),
    repo.getSettings().catch(() => ({})),
  ]);

  /* Identité */
  screen.append(identityCard(profile));

  /* Réglages simples */
  screen.append(section('Préférences', {}, simpleSettings(settings)));

  /* Portes vers les écrans détaillés */
  screen.append(section('Configuration', {},
    h('div.rows',
      navRow(glyph('bank'), 'Comptes et connexions', 'Banque, Kraken, OKX', '/profil/comptes'),
      navRow(glyph('tag'), 'Catégories', 'Renommer, budgets, couleurs', '/profil/categories'),
      navRow(glyph('ruler'), 'Règles et mémoire', 'Ce que WALLET a appris', '/banque/regles'),
      navRow(glyph('bell'), 'Alertes', 'Prix, score, budget', '/profil/alertes'),
      navRow(glyph('target'), 'Objectifs', 'Patrimoine, épargne', '/profil/objectifs'),
      navRow(glyph('settings'), 'Paramètres du moteur', 'Poids du score, zones, scénarios', '/profil/moteur'),
    ),
  ));

  /* À propos et session */
  screen.append(section('À propos', {}, aboutBlock(profile)));

  return screen;
}

function identityCard(profile) {
  const avatar = h('div.avatar', {
    style: { width: '64px', height: '64px', fontSize: '22px', fontWeight: '700' },
  }, repo.isDemoMode() ? glyph('flask') : initials(profile?.full_name, profile?.email));

  if (profile?.avatar_path) {
    repo.getAvatarUrl(profile.avatar_path).then((url) => {
      if (url) mount(avatar, h('img', { src: url, alt: '' }));
    }).catch(() => {});
  }

  return h('button.card.card--tap', {
    type: 'button', 'data-sound': 'sheetOpen',
    style: { width: '100%', textAlign: 'left' },
    onclick: () => editProfile(profile),
  },
    h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center' } },
      avatar,
      h('div', { style: { minWidth: 0, flex: '1' } },
        h('div', { style: { fontWeight: '700', fontSize: '18px' } },
          repo.isDemoMode()
            ? 'Mode démonstration'
            : (profile?.full_name || profile?.username || 'Mon compte')),
        h('div.muted', { style: { fontSize: 'var(--fs-sm)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          repo.isDemoMode()
            ? 'Données simulées, stockées sur cet appareil'
            : (profile?.email ?? '')),
      ),
      h('span', { style: { color: 'var(--text-3)' } }, '›'),
    ),
  );
}

function simpleSettings(settings) {
  const container = h('div');

  const update = async (patch) => {
    try {
      await repo.updateSettings(patch);
      Object.assign(settings, patch);
    } catch (error) {
      toast(`Réglage non enregistré : ${error.message}`, { kind: 'error' });
    }
  };

  mount(container,
    /* Thème */
    h('div.switch-row',
      h('div',
        h('div.switch-row__label', 'Apparence'),
        h('div.switch-row__hint', 'Ou celle du téléphone'),
      ),
      h('div.segmented',
        [['dark', 'Sombre'], ['light', 'Clair'], ['system', 'Auto']].map(([value, label]) =>
          h('button', {
            type: 'button', 'data-sound': 'toggle',
            'aria-selected': String((settings.theme ?? 'dark') === value),
            onclick: (event) => {
              [...event.currentTarget.parentElement.children]
                .forEach((b) => b.setAttribute('aria-selected', String(b === event.currentTarget)));
              applyTheme(value);
              update({ theme: value });
            },
          }, label)),
      ),
    ),

    /* Devise */
    h('div.switch-row',
      h('div',
        h('div.switch-row__label', 'Devise'),
        h('div.switch-row__hint', 'Euro et dollar sont aussi accessibles d’un geste depuis l’accueil'),
      ),
      h('select', {
        style: { background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '10px 14px' },
        onchange: (event) => {
          const code = event.target.value;
          // Le changement s'applique tout de suite : demander de recharger
          // pour voir l'effet d'un réglage, c'est avouer qu'il ne marche pas.
          const applied = setDisplayCurrency(code);
          update({ base_currency: code });
          toast(applied
            ? `Montants affichés en ${code}`
            : `Taux ${code} indisponible pour l’instant`);
        },
      },
        SUPPORTED.map((code) =>
          h('option', { value: code, selected: displayCurrency() === code }, code)),
      ),
    ),

    switchRow({
      label: 'Mode avancé',
      hint: 'Affiche les indicateurs, ratios et modèles sur les fiches',
      explain: 'investment_score',
      checked: settings.ui_mode === 'advanced',
      onChange: (value) => update({ ui_mode: value ? 'advanced' : 'simple' }),
    }),

    switchRow({
      label: 'Masquer les montants',
      hint: 'Floute les chiffres. Touchez un montant pour le révéler.',
      checked: Boolean(settings.privacy_blur),
      onChange: (value) => {
        document.body.dataset.blur = value ? 'on' : 'off';
        update({ privacy_blur: value });
      },
    }),

    switchRow({
      label: 'Sons d’interface',
      hint: 'Retours sonores discrets au toucher',
      checked: settings.sound_enabled !== false,
      onChange: (value) => { setFeedbackPrefs({ sound: value }); update({ sound_enabled: value }); },
    }),

    switchRow({
      label: 'Vibrations',
      hint: 'Sans effet sur iPhone : Safari n’expose pas cette fonction.',
      checked: settings.haptics_enabled !== false,
      onChange: (value) => { setFeedbackPrefs({ haptics: value }); update({ haptics_enabled: value }); },
    }),
  );

  return container;
}

function navRow(emoji, title, subtitle, path) {
  return h('button.row', {
    type: 'button', 'data-sound': 'select',
    onclick: () => navigate(path),
  },
    h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } }, emoji),
    h('div.row__main',
      h('div.row__title', title),
      h('div.row__sub', subtitle),
    ),
    h('div.row__end', h('span', { style: { color: 'var(--text-3)' } }, '›')),
  );
}

function aboutBlock(profile) {
  return h('div',
    h('div.rows',
      h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
        h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, 'Version')),
        h('div.row__end', h('div.row__value', config.version)),
      ),
      h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
        h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, 'Mode')),
        h('div.row__end', h('div.row__value',
          repo.isDemoMode() ? 'Démonstration' : 'Connecté')),
      ),
    ),

    h('div', { style: { display: 'grid', gap: '10px', marginTop: '20px' } },
      repo.isDemoMode()
        ? h('button.btn.btn--primary.btn--block', {
            type: 'button', 'data-sound': 'select', onclick: () => openServerSheet(),
          }, 'Connecter mon serveur Supabase')
        : null,

      repo.isDemoMode()
        ? h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: async () => {
              const ok = await confirmSheet({
                title: 'Réinitialiser la démonstration ?',
                message: 'Vos corrections de catégories et vos réglages de démonstration seront effacés. Aucune donnée réelle n’est concernée.',
                confirmLabel: 'Réinitialiser', danger: true,
              });
              if (!ok) return;
              repo.resetDemo();
              window.location.reload();
            },
          }, 'Réinitialiser la démonstration')
        : h('button.btn.btn--ghost.btn--block', {
            type: 'button',
            onclick: async () => {
              const ok = await confirmSheet({
                title: 'Se déconnecter ?',
                message: 'Vos données restent sur votre serveur. Vous pourrez vous reconnecter à tout moment.',
                confirmLabel: 'Se déconnecter',
              });
              if (!ok) return;
              await repo.signOut();
              window.location.reload();
            },
          }, 'Se déconnecter'),
    ),

    h('p.explain__source', { style: { marginTop: '20px' } },
      'WALLET est un outil de lecture et d’analyse. Il ne peut ni acheter, ni vendre, ni transférer : les clés d’exchange sont enregistrées en lecture seule.'),
  );
}

/* — Édition du profil ————————————————————————————— */

function editProfile(profile) {
  openSheet({
    title: 'Mon profil',
    build: ({ close }) => {
      const fullName = h('input', { type: 'text', value: profile?.full_name ?? '' });
      const username = h('input', { type: 'text', value: profile?.username ?? '' });
      const photo = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
      const error = h('div.field__error');

      return h('div',
        h('form', {
          onsubmit: async (event) => {
            event.preventDefault();
            error.textContent = '';
            try {
              if (photo.files?.[0]) await repo.uploadAvatar(photo.files[0]);
              await repo.updateProfile({
                full_name: fullName.value.trim(),
                username: username.value.trim() || null,
              });
              close();
              toast('Profil enregistré', { kind: 'success' });
              setTimeout(() => window.location.reload(), 400);
            } catch (e) {
              error.textContent = e.message;
            }
          },
        },
          h('div.field', h('label', 'Photo'), photo,
            h('div.field__hint', 'PNG, JPEG ou WebP, 2 Mo maximum. Stockée dans un espace privé, accessible à vous seul.')),
          h('div.field', h('label', 'Nom'), fullName),
          h('div.field', h('label', 'Pseudo'), username,
            h('div.field__hint', 'Lettres, chiffres, tirets et points, de 3 à 32 caractères.')),
          error,
          h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
            'Enregistrer'),
        ),

        repo.isDemoMode() ? null : h('div', { style: { marginTop: '24px' } },
          h('div.rows',
            h('button.row', {
              type: 'button',
              onclick: async () => {
                const address = prompt('Nouvelle adresse e-mail ?');
                if (!address) return;
                try {
                  await repo.updateEmail(address.trim());
                  toast('Confirmez le changement depuis le message envoyé aux deux adresses.');
                } catch (e) { toast(e.message, { kind: 'error' }); }
              },
            }, h('div.row__main', h('div.row__title', 'Changer d’adresse e-mail')),
               h('div.row__end', h('span.muted', profile?.email))),

            h('button.row', {
              type: 'button',
              onclick: async () => {
                const next = prompt('Nouveau mot de passe ? (8 caractères minimum)');
                if (!next) return;
                if (next.length < 8) { toast('Trop court', { kind: 'error' }); return; }
                try {
                  await repo.updatePassword(next);
                  toast('Mot de passe modifié', { kind: 'success' });
                } catch (e) { toast(e.message, { kind: 'error' }); }
              },
            }, h('div.row__main', h('div.row__title', 'Changer de mot de passe'))),
          ),
        ),
      );
    },
  });
}

/* ================================================================== */
/* Paramètres du moteur (§27, §28, §35)                                */
/* ================================================================== */

export async function engineScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('Paramètres du moteur'));

  const body = h('div');
  screen.append(body);
  mount(body, loadingBlock(300));

  try {
    const model = await repo.getScoreModel();
    const weights = { ...DEFAULT_WEIGHTS, ...(model.weights || {}) };
    const zones = { ...DEFAULT_ZONES, ...(model.zone_thresholds || {}) };

    const totalLabel = h('span.num', { style: { fontWeight: '700' } });
    const sliders = new Map();

    const refreshTotal = () => {
      const total = [...sliders.values()].reduce((a, input) => a + Number(input.value), 0);
      totalLabel.textContent = String(total);
      totalLabel.style.color = total === 0 ? 'var(--down)' : 'var(--text)';
    };

    const weightRows = Object.keys(DEFAULT_WEIGHTS).map((key) => {
      const input = h('input', {
        type: 'range', min: '0', max: '40', step: '1', value: String(weights[key]),
        style: { width: '100%', accentColor: 'var(--accent)' },
        'aria-label': FACTOR_LABELS[key],
      });
      const value = h('span.num', { style: { fontWeight: '600', minWidth: '28px', textAlign: 'right' } },
        String(weights[key]));

      input.addEventListener('input', () => { value.textContent = input.value; refreshTotal(); });
      sliders.set(key, input);

      return h('div', { style: { paddingBlock: '12px', borderTop: '1px solid var(--hairline)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
          h('span', { style: { fontWeight: '500' } }, FACTOR_LABELS[key]),
          value,
        ),
        h('div.muted-2', { style: { fontSize: 'var(--fs-xs)', marginBottom: '8px' } }, FACTOR_HELP[key]),
        input,
      );
    });

    const zoneInputs = new Map();
    const zoneRows = ['exceptional', 'interesting', 'neutral', 'expensive'].map((key) => {
      const input = h('input', {
        type: 'number', min: '0', max: '100', step: '1', value: String(zones[key]),
        inputmode: 'numeric',
        style: { background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: '10px 14px',
          width: '84px', textAlign: 'right', fontWeight: '600' },
      });
      zoneInputs.set(key, input);

      return h('div.switch-row',
        h('div',
          h('div.switch-row__label', `${ZONE_META[key].emoji} ${ZONE_META[key].label}`),
          h('div.switch-row__hint', 'à partir de'),
        ),
        input,
      );
    });

    const error = h('div.field__error');

    mount(body,
      h('p.muted', { style: { marginBottom: '20px' } },
        'Le score est une moyenne pondérée. Ces poids sont les vôtres : mettez un facteur à zéro et il disparaît du calcul.'),

      h('div.card',
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div.eyebrow', 'Poids des facteurs', explainChip('investment_score', { label: 'score' })),
          h('div', h('span.muted', { style: { fontSize: 'var(--fs-sm)' } }, 'Total : '), totalLabel),
        ),
        weightRows,
      ),

      section('Seuils des zones', {}, h('div.card', zoneRows,
        h('p.explain__source', { style: { marginTop: '12px' } },
          'Les seuils doivent aller du plus haut au plus bas : exceptionnelle > intéressante > neutre > chère.'))),

      error,

      h('div', { style: { display: 'grid', gap: '10px', marginTop: '24px' } },
        h('button.btn.btn--primary.btn--block', {
          type: 'button', 'data-sound': 'select',
          onclick: async () => {
            error.textContent = '';

            const nextWeights = Object.fromEntries(
              [...sliders.entries()].map(([key, input]) => [key, Number(input.value)]));
            if (Object.values(nextWeights).reduce((a, b) => a + b, 0) === 0) {
              error.textContent = 'Au moins un facteur doit avoir un poids supérieur à zéro.';
              return;
            }

            const nextZones = Object.fromEntries(
              [...zoneInputs.entries()].map(([key, input]) => [key, Number(input.value)]));
            const ordered = ['exceptional', 'interesting', 'neutral', 'expensive']
              .map((key) => nextZones[key]);
            if (!ordered.every((v, i) => i === 0 || v < ordered[i - 1])) {
              error.textContent = 'Les seuils doivent être strictement décroissants.';
              return;
            }

            try {
              await repo.saveScoreModel({ ...model, weights: nextWeights, zone_thresholds: nextZones });
              toast('Paramètres enregistrés', { kind: 'success' });
              setTimeout(() => window.location.reload(), 500);
            } catch (e) {
              error.textContent = e.message;
            }
          },
        }, 'Enregistrer'),

        h('button.btn.btn--ghost.btn--block', {
          type: 'button',
          onclick: () => {
            for (const [key, input] of sliders) {
              input.value = String(DEFAULT_WEIGHTS[key]);
              input.dispatchEvent(new Event('input'));
            }
            for (const [key, input] of zoneInputs) input.value = String(DEFAULT_ZONES[key]);
            toast('Valeurs par défaut restaurées (non enregistrées)');
          },
        }, 'Revenir aux valeurs par défaut'),
      ),
    );

    refreshTotal();
  } catch (error) {
    mount(body, errorState(error, { what: 'les paramètres du moteur' }));
  }

  return screen;
}

/* ================================================================== */
/* Catégories                                                          */
/* ================================================================== */

export async function categoriesScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('Catégories'));

  const body = h('div');
  screen.append(body);
  mount(body, loadingRows(8));

  async function paint() {
    try {
      const categories = await repo.listCategories();
      const groups = [
        ['Dépenses', categories.filter((c) => c.kind === 'expense')],
        ['Revenus', categories.filter((c) => c.kind === 'income')],
        ['Investissement', categories.filter((c) => c.kind === 'investment')],
        ['Transferts', categories.filter((c) => c.kind === 'transfer')],
      ];

      mount(body,
        h('p.muted', { style: { marginBottom: '16px' } },
          'Renommez, changez l’emoji, fixez un budget mensuel. Les catégories livrées peuvent être modifiées mais pas supprimées, pour ne jamais casser un historique.'),

        groups.filter(([, list]) => list.length).map(([title, list]) =>
          section(title, {}, h('div.rows', list.map((category) => h('button.row', {
            type: 'button', 'data-sound': 'sheetOpen',
            onclick: () => editCategory(category, paint),
          },
            h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } }, category.emoji),
            h('div.row__main',
              h('div.row__title', category.label),
              h('div.row__sub', category.budget_month
                ? `Budget ${money(Number(category.budget_month), { decimals: 0 })} / mois`
                : 'Aucun budget'),
            ),
            h('div.row__end', h('span', { style: { color: 'var(--text-3)' } }, '›')),
          ))))),
      );
    } catch (error) {
      mount(body, errorState(error, { what: 'vos catégories', onRetry: paint }));
    }
  }

  await paint();
  return screen;
}

function editCategory(category, onChange) {
  openSheet({
    title: category.label,
    build: ({ close }) => {
      const label = h('input', { type: 'text', value: category.label, required: true });
      const emoji = h('input', { type: 'text', value: category.emoji, maxlength: 4,
        style: { fontSize: '24px', textAlign: 'center' } });
      const budget = h('input', { type: 'number', step: '10', min: '0', inputmode: 'decimal',
        value: category.budget_month ?? '' });

      return h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            await repo.saveCategory({
              id: category.id,
              label: label.value.trim(),
              emoji: emoji.value.trim() || glyph('box'),
              budget_month: budget.value ? Number(budget.value) : null,
            });
            close();
            toast('Catégorie enregistrée', { kind: 'success' });
            onChange?.();
          } catch (error) {
            toast(error.message, { kind: 'error' });
          }
        },
      },
        h('div.field', h('label', 'Emoji'), emoji),
        h('div.field', h('label', 'Nom'), label),
        h('div.field', h('label', 'Budget mensuel'), budget,
          h('div.field__hint', 'Laissez vide pour ne pas suivre de budget sur cette catégorie.')),
        h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
          'Enregistrer'),
      );
    },
  });
}
