/**
 * WALLET · Comptes et connexions (§3, §4)
 *
 * Trois façons d'alimenter WALLET, présentées honnêtement :
 *   1. Kraken et OKX  — clés API en LECTURE SEULE, chiffrées côté serveur
 *   2. Banque         — import de relevé CSV/OFX
 *   3. Manuel         — saisie d'un solde
 *
 * Sur la banque : aucun agrégateur bancaire français (Powens, Bridge, Budget
 * Insight…) n'a d'offre gratuite exploitable. Plutôt que de faire croire à une
 * synchronisation automatique, WALLET assume l'import de relevé et prépare
 * l'architecture pour brancher un agrégateur le jour où vous en choisirez un.
 */

import { h, mount } from '../lib/dom.js';
import { navigate } from '../lib/router.js';
import { openSheet, confirmSheet } from '../lib/sheet.js';
import { toast } from '../lib/toast.js';
import { currencyToggle } from '../components/ui.js';
import {
  subScreenHead, section, loadingRows, emptyState, errorState, badge, freshness,
} from '../components/ui.js';
import { money, day as fmtDay } from '../lib/fmt.js';
import * as repo from '../data/repo.js';
import { parseStatement, SUPPORTED_FORMATS } from '../data/import.js';

export async function accountsScreen() {
  const screen = h('main.screen');
  screen.append(subScreenHead('Comptes et connexions', { right: currencyToggle({ compact: true }) }));

  const accountsHost = h('div');
  const exchangeHost = h('div');

  screen.append(
    section('Mes comptes', {
      action: h('button.btn.btn--ghost.btn--sm', {
        type: 'button', 'data-sound': 'sheetOpen', onclick: () => editAccount(null, paint),
      }, '+ Ajouter'),
    }, accountsHost),

    section('Exchanges', { }, exchangeHost),

    section('Importer un relevé', {}, importBlock()),
  );

  mount(accountsHost, loadingRows(3));
  mount(exchangeHost, loadingRows(2));

  async function paint() {
    try {
      const [accounts, holdings] = await Promise.all([
        repo.getAccounts(),
        repo.getHoldings().catch(() => []),
      ]);

      // Positions par compte : un exchange vaut ses liquidités PLUS ses
      // cryptos. Sans cela, OKX s'affichait sans valeur alors que ses
      // positions pesaient plusieurs milliers d'euros.
      const positionsByAccount = new Map();
      for (const holding of holdings) {
        const id = holding.account_id ?? holding.account?.id;
        if (!id || !Number.isFinite(holding.value)) continue;
        positionsByAccount.set(id, (positionsByAccount.get(id) ?? 0) + holding.value);
      }

      mount(accountsHost, accounts.length
        ? h('div.rows', accounts.map((account) => h('button.row', {
            type: 'button', 'data-sound': 'sheetOpen',
            onclick: () => editAccount(account, paint),
          },
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
              const known = hasCash || positions > 0;
              return h('div.row__end',
                known
                  ? h('div.row__value.sensitive', money((hasCash ? cash : 0) + positions))
                  : h('div.row__value.unknown', '—'),
                positions > 0
                  ? h('div.row__sub.muted-2', `dont ${money(positions)} en positions`)
                  : h('div.row__sub.muted-2', ''),
              );
            })(),
          )))
        : emptyState({ emoji: '🏦', title: 'Aucun compte',
            body: 'Ajoutez un compte bancaire, un exchange, ou une simple ligne de liquidités.' }));
    } catch (error) {
      mount(accountsHost, errorState(error, { what: 'vos comptes', onRetry: paint }));
    }
  }

  async function paintExchanges() {
    if (repo.isDemoMode()) {
      mount(exchangeHost, h('div.notice',
        h('span', '🧪'),
        h('div', h('strong', 'Mode démonstration'),
          'Connectez d’abord votre serveur Supabase : les clés d’exchange ne peuvent être chiffrées que côté serveur, jamais dans le navigateur.')));
      return;
    }

    try {
      const credentials = await repo.listCredentials();
      mount(exchangeHost,
        h('div.rows',
          ['kraken', 'okx'].map((provider) => {
            const existing = credentials.find((c) => c.provider === provider);
            return h('button.row', {
              type: 'button', 'data-sound': 'sheetOpen',
              onclick: () => existing ? manageCredential(existing, paintExchanges)
                                      : connectExchange(provider, paintExchanges),
            },
              h('div.avatar', { style: { background: 'var(--surface-2)', fontSize: '18px' } }, '🪙'),
              h('div.row__main',
                h('div.row__title', provider === 'kraken' ? 'Kraken' : 'OKX'),
                h('div.row__sub', existing
                  ? `Connecté · clé ••${existing.fingerprint ?? ''}`
                  : 'Non connecté'),
              ),
              h('div.row__end',
                existing
                  ? (existing.last_error
                      ? badge('erreur', 'down')
                      : badge('lecture seule', 'accent'))
                  : h('span', { style: { color: 'var(--text-3)' } }, '›'),
              ),
            );
          }),
        ),

        h('div.notice', { style: { marginTop: '14px' } },
          h('span', '🔒'),
          h('div',
            h('strong', 'Lecture seule, sans exception'),
            'WALLET refuse toute clé disposant de droits de trading ou de retrait, et n’appelle jamais d’endpoint d’ordre. Vos clés sont chiffrées côté serveur et ne redescendent jamais dans le navigateur.')),
      );
    } catch (error) {
      mount(exchangeHost, errorState(error, { what: 'vos connexions', onRetry: paintExchanges }));
    }
  }

  await Promise.all([paint(), paintExchanges()]);
  return screen;
}

/* — Compte manuel ————————————————————————————————— */

function editAccount(account, onChange) {
  openSheet({
    title: account ? account.label : 'Nouveau compte',
    build: ({ close }) => {
      const label = h('input', { type: 'text', value: account?.label ?? '', required: true });
      const kind = h('select',
        [['bank', '🏦 Compte bancaire'], ['cash', '💶 Liquidités'], ['broker', '📈 Courtier'],
         ['manual', '✍️ Autre actif']].map(([value, text]) =>
          h('option', { value, selected: account?.kind === value }, text)));
      const balance = h('input', {
        type: 'number', step: '0.01', inputmode: 'decimal',
        value: account?.balance ?? '',
        placeholder: 'Laissez vide si inconnu',
      });
      const iban = h('input', { type: 'text', maxlength: 4, value: account?.iban_last4 ?? '',
        placeholder: '4 derniers chiffres' });
      const error = h('div.field__error');

      return h('div',
        h('form', {
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await repo.saveAccount({
                ...(account?.id ? { id: account.id } : {}),
                label: label.value.trim(),
                kind: kind.value,
                provider: account?.provider ?? 'manual',
                currency: account?.currency ?? 'EUR',
                iban_last4: iban.value.trim() || null,
                // Vide = INCONNU, pas zéro. C'est la règle §46 appliquée
                // jusque dans la saisie.
                balance: balance.value === '' ? null : Number(balance.value),
                balance_at: balance.value === '' ? null : new Date().toISOString(),
              });
              close();
              toast('Compte enregistré', { kind: 'success' });
              onChange?.();
            } catch (e) {
              error.textContent = e.message;
            }
          },
        },
          h('div.field', h('label', 'Nom'), label),
          h('div.field', h('label', 'Type'), kind),
          h('div.field', h('label', 'Solde'), balance,
            h('div.field__hint', 'Laissez vide si vous ne le connaissez pas : WALLET affichera « — » et marquera votre patrimoine comme partiel, plutôt que de compter 0 €.')),
          h('div.field', h('label', 'Fin d’IBAN'), iban),
          error,
          h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
            'Enregistrer'),
        ),

        account ? h('button.btn.btn--danger.btn--block', {
          type: 'button', style: { marginTop: '12px' },
          onclick: async () => {
            const ok = await confirmSheet({
              title: 'Supprimer ce compte ?',
              message: 'Ses transactions et positions seront également supprimées. Cette action est définitive.',
              confirmLabel: 'Supprimer', danger: true,
            });
            if (!ok) return;
            await repo.deleteAccount(account.id);
            close();
            toast('Compte supprimé');
            onChange?.();
          },
        }, 'Supprimer ce compte') : null,
      );
    },
  });
}

/* — Exchanges ————————————————————————————————————— */

function connectExchange(provider, onChange) {
  const isOkx = provider === 'okx';

  openSheet({
    title: `Connecter ${isOkx ? 'OKX' : 'Kraken'}`,
    build: ({ close }) => {
      const apiKey = h('input', { type: 'text', required: true, autocapitalize: 'off', spellcheck: false });
      const apiSecret = h('input', { type: 'password', required: true, autocapitalize: 'off', spellcheck: false });
      const passphrase = h('input', { type: 'password', autocapitalize: 'off', spellcheck: false });
      const confirm = h('input', { type: 'checkbox', required: true });
      const error = h('div.field__error');
      const submit = h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
        'Connecter en lecture seule');

      return h('form', {
        onsubmit: async (event) => {
          event.preventDefault();
          error.textContent = '';
          submit.disabled = true;
          submit.textContent = 'Vérification…';

          try {
            const result = await repo.saveCredential({
              provider,
              label: isOkx ? 'OKX' : 'Kraken',
              apiKey: apiKey.value.trim(),
              apiSecret: apiSecret.value.trim(),
              passphrase: isOkx ? passphrase.value.trim() : undefined,
            });
            close();
            toast(result?.permissions_ok === false
              ? 'Clé enregistrée, mais ses droits n’ont pas pu être vérifiés.'
              : 'Connecté en lecture seule', { kind: 'success' });
            onChange?.();
          } catch (e) {
            error.textContent = e.message;
            submit.disabled = false;
            submit.textContent = 'Connecter en lecture seule';
          }
        },
      },
        h('div.notice.notice--warn',
          h('span', '⚠️'),
          h('div',
            h('strong', 'Créez une clé en LECTURE SEULE'),
            isOkx
              ? 'Dans OKX : API → Créer une clé, cochez uniquement « Read ». Ne cochez ni « Trade » ni « Withdraw ».'
              : 'Dans Kraken : Settings → API → Add key, cochez uniquement « Query Funds » et « Query Ledger Entries ». Ne cochez aucune permission de trading ni de retrait.')),

        h('div.field', { style: { marginTop: '20px' } }, h('label', 'Clé API'), apiKey),
        h('div.field', h('label', 'Secret'), apiSecret),
        isOkx ? h('div.field', h('label', 'Passphrase'), passphrase) : null,

        h('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start',
          marginTop: '16px', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' } },
          confirm,
          h('span', 'Je confirme que cette clé n’a AUCUN droit de trading ni de retrait.')),

        error,
        h('div', { style: { marginTop: '20px' } }, submit),

        h('p.explain__source', { style: { marginTop: '16px' } },
          'Votre secret est envoyé une seule fois à une fonction serveur qui le chiffre immédiatement. Il n’est jamais stocké dans ce navigateur, jamais renvoyé, et jamais visible dans l’application.'),
      );
    },
  });
}

function manageCredential(credential, onChange) {
  openSheet({
    title: credential.provider === 'okx' ? 'OKX' : 'Kraken',
    build: ({ close }) => h('div',
      h('div.rows',
        line('Statut', credential.last_error ? 'Erreur' : 'Connecté'),
        line('Droits', 'Lecture seule'),
        line('Clé', `••${credential.fingerprint ?? ''}`),
        line('Ajoutée le', fmtDay(credential.created_at, { long: true })),
        line('Dernier usage', credential.last_used_at ? fmtDay(credential.last_used_at, { long: true }) : 'jamais'),
      ),

      credential.last_error
        ? h('div.notice.notice--danger', { style: { marginTop: '16px' } },
            h('span', '⚠️'), h('div', h('strong', 'Dernière erreur'), credential.last_error))
        : null,

      h('div', { style: { display: 'grid', gap: '10px', marginTop: '24px' } },
        h('button.btn.btn--secondary.btn--block', {
          type: 'button', 'data-sound': 'select',
          onclick: async () => {
            try {
              await repo.triggerSync(credential.provider);
              toast('Synchronisation lancée', { kind: 'success' });
              close();
            } catch (e) { toast(e.message, { kind: 'error' }); }
          },
        }, 'Synchroniser maintenant'),

        h('button.btn.btn--danger.btn--block', {
          type: 'button',
          onclick: async () => {
            const ok = await confirmSheet({
              title: 'Déconnecter ?',
              message: 'La clé chiffrée sera supprimée. Vos positions déjà synchronisées restent visibles.',
              confirmLabel: 'Déconnecter', danger: true,
            });
            if (!ok) return;
            await repo.deleteCredential(credential.id);
            close();
            toast('Déconnecté');
            onChange?.();
          },
        }, 'Déconnecter'),
      ),
    ),
  });
}

function line(label, value) {
  return h('div.row', { style: { gridTemplateColumns: '1fr auto' } },
    h('div.row__main', h('div.row__title', { style: { fontWeight: '500' } }, label)),
    h('div.row__end', h('div.row__value', value)),
  );
}

/* — Import de relevé ————————————————————————————— */

function importBlock() {
  const container = h('div');

  const file = h('input', {
    type: 'file',
    accept: '.csv,.ofx,.qif,text/csv,text/plain',
    style: { display: 'none' },
  });

  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    file.value = '';
    await handleImport(chosen);
  });

  mount(container,
    h('div.card',
      h('p.muted', { style: { fontSize: 'var(--fs-sm)' } },
        'Aucun agrégateur bancaire français n’offre d’accès gratuit exploitable. WALLET lit donc vos relevés exportés — depuis Boursorama : Compte → Opérations → Exporter.'),

      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' } },
        SUPPORTED_FORMATS.map((f) => badge(f.toUpperCase()))),

      h('button.btn.btn--primary.btn--block', {
        type: 'button', 'data-sound': 'select', style: { marginTop: '18px' },
        onclick: () => file.click(),
      }, 'Choisir un fichier'),

      file,

      h('p.explain__source', { style: { marginTop: '14px' } },
        'Les doublons sont détectés automatiquement : réimporter un relevé qui chevauche le précédent ne crée pas de transactions en double.'),
    ),
  );

  return container;
}

async function handleImport(file) {
  const accounts = await repo.getAccounts();
  const bankAccounts = accounts.filter((a) => a.kind === 'bank' || a.kind === 'cash');

  if (!bankAccounts.length) {
    toast('Créez d’abord un compte bancaire', { kind: 'error' });
    return;
  }

  const text = await file.text();

  openSheet({
    title: 'Importer un relevé',
    build: ({ close }) => {
      const account = h('select', bankAccounts.map((a) => h('option', { value: a.id }, a.label)));
      const preview = h('div');
      const error = h('div.field__error');
      const submit = h('button.btn.btn--primary.btn--block', {
        type: 'button', 'data-sound': 'select', disabled: true,
      }, 'Analyse…');

      let parsed = null;

      const analyse = () => {
        try {
          parsed = parseStatement(text, { filename: file.name, accountId: account.value });
          if (!parsed.rows.length) {
            error.textContent = 'Aucune transaction reconnue dans ce fichier.';
            submit.disabled = true;
            mount(preview, h('div'));
            return;
          }
          error.textContent = '';
          submit.disabled = false;
          submit.textContent = `Importer ${parsed.rows.length} transactions`;

          mount(preview,
            h('div.rows', { style: { marginTop: '16px', maxHeight: '32vh', overflowY: 'auto' } },
              parsed.rows.slice(0, 10).map((row) => h('div.row',
                h('div.row__main',
                  h('div.row__title', row.raw_label),
                  h('div.row__sub', fmtDay(row.booked_at)),
                ),
                h('div.row__end', h('div.row__value', money(row.amount))),
              ))),
            parsed.rows.length > 10
              ? h('p.muted-2', { style: { fontSize: 'var(--fs-xs)', marginTop: '8px' } },
                  `… et ${parsed.rows.length - 10} autres`)
              : null,
            parsed.warnings.length
              ? h('div.notice.notice--warn', { style: { marginTop: '12px' } },
                  h('span', '⚠️'),
                  h('div', h('strong', `${parsed.warnings.length} lignes ignorées`),
                    parsed.warnings.slice(0, 3).join(' · ')))
              : null,
          );
        } catch (e) {
          error.textContent = e.message;
          submit.disabled = true;
        }
      };

      account.addEventListener('change', analyse);
      queueMicrotask(analyse);

      submit.addEventListener('click', async () => {
        submit.disabled = true;
        submit.textContent = 'Import…';
        try {
          const result = await repo.importTransactions(parsed.rows, {
            account_id: account.value,
            filename: file.name,
            format: parsed.format,
            period_start: parsed.periodStart,
            period_end: parsed.periodEnd,
          });
          close();
          toast(result
            ? `${result.imported} importées, ${result.skipped} déjà connues`
            : 'Import effectué', { kind: 'success' });
          setTimeout(() => window.location.reload(), 800);
        } catch (e) {
          error.textContent = e.message;
          submit.disabled = false;
          submit.textContent = 'Réessayer';
        }
      });

      return h('div',
        h('div.field', h('label', 'Compte de destination'), account),
        h('div.muted', { style: { fontSize: 'var(--fs-sm)' } },
          `Fichier : ${file.name} (${Math.round(file.size / 1024)} Ko)`),
        preview,
        error,
        h('div', { style: { marginTop: '20px' } }, submit),
      );
    },
  });
}
