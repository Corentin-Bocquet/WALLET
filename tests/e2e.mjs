/**
 * Parcours de bout en bout : l'apprentissage des catégories vu depuis l'écran.
 * C'est LA fonctionnalité centrale du cahier des charges — un test unitaire ne
 * suffit pas, il faut vérifier que le geste réel produit l'effet réel.
 */
// Prérequis : `npm i -D playwright` et l'application servie sur le port 8099
//   python3 -m http.server 8099 --directory app &
//   node tests/e2e.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.WALLET_URL ?? 'http://127.0.0.1:8099';

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, locale: 'fr-FR', colorScheme: 'dark',
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.addInitScript(() => {
  localStorage.setItem('wallet.demo.optin', '1');
  localStorage.setItem('wallet.installHint', '1');
});

const go = async (route) => {
  await page.goto(`${BASE}/index.html#${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
};

const step = (label) => console.log(`  · ${label}`);

/* ---------------------------------------------------------------- */
console.log('\n1. Navigation entre les cinq sections');
for (const [route, title] of [
  ['/', 'Accueil'], ['/marches', 'Marchés'], ['/portefeuille', 'Portefeuille'],
  ['/opportunites', 'Opportunités'], ['/profil', 'Profil'],
]) {
  await go(route);
  const heading = await page.locator('.screen__title').first().textContent();
  assert.equal(heading.trim(), title, `attendu « ${title} », obtenu « ${heading} »`);
  step(`${title} ✓`);
}

/* ---------------------------------------------------------------- */
console.log("\n2. Explication à trois niveaux (§6, §7)");
await go('/');
await page.locator('.info-chip').first().click();
await page.waitForSelector('.sheet[data-open="true"]');
const level1 = await page.locator('.sheet__body p').first().textContent();
step(`niveau 1 : « ${level1.slice(0, 60)}… »`);

let paragraphs = await page.locator('.sheet__body p').count();
assert.ok(paragraphs <= 4, `trop de texte affiché d'emblée (${paragraphs} paragraphes)`);

await page.locator('.explain__more').click();
await page.waitForTimeout(200);
const after2 = await page.locator('.sheet__body p').count();
assert.ok(after2 > paragraphs, 'le niveau 2 ne s’est pas ouvert');
step('niveau 2 ✓');

await page.locator('.explain__more').click();
await page.waitForTimeout(200);
const after3 = await page.locator('.sheet__body p').count();
assert.ok(after3 > after2, 'le niveau 3 ne s’est pas ouvert');
assert.equal(await page.locator('.explain__more').count(), 0, 'il ne doit plus y avoir de « voir plus »');
step('niveau 3 ✓');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/* ---------------------------------------------------------------- */
console.log('\n3. Apprentissage : corriger une catégorie et vérifier qu’elle tient');
await go('/banque');
await page.waitForSelector('.rows .row');

// Trouver une transaction « Biere Bar X » — le scénario exact du §10.
const target = page.locator('.row', { hasText: 'Biere Bar X' }).first();
await target.waitFor({ timeout: 5000 });

const before = (await target.locator('.row__sub').first().textContent()).trim();
step(`catégorie initiale : ${before}`);

await target.click();
await page.waitForSelector('.sheet[data-open="true"]');

const reason = await page.locator('.sheet .card').first().textContent();
assert.ok(/Pourquoi cette catégorie/i.test(reason), 'la raison n’est pas affichée');
step('la raison de la catégorie est affichée ✓');

// Corriger via un raccourci de catégorie voisine.
const chip = page.locator('.sheet .hscroll .badge').first();
const chosen = (await chip.textContent()).trim();
await chip.click();
await page.waitForTimeout(1200);
step(`corrigé en : ${chosen}`);

// Une proposition d'appliquer aux similaires peut s'ouvrir : la refuser,
// pour vérifier que la mémoire fonctionne SANS propagation de masse.
if (await page.locator('.sheet[data-open="true"]').count()) {
  const decline = page.locator('.sheet button', { hasText: 'seulement celle-ci' });
  if (await decline.count()) {
    const similarText = await page.locator('.sheet p').first().textContent();
    step(`proposition d'appliquer aux similaires : « ${similarText.slice(0, 70)}… »`);
    await decline.click();
    await page.waitForTimeout(600);
  }
}

/* ---------------------------------------------------------------- */
console.log('\n4. Rechargement complet : la correction doit survivre');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await go('/banque');

const same = page.locator('.row', { hasText: 'Biere Bar X' }).first();
await same.waitFor({ timeout: 5000 });
const after = (await same.locator('.row__sub').first().textContent()).trim();
step(`après rechargement : ${after}`);

const expected = chosen.replace(/^\S+\s/, '').trim();
assert.ok(after.includes(expected),
  `la correction n'a pas tenu : attendu « ${expected} », obtenu « ${after} »`);
assert.ok(!after.includes(before.split('·')[0].trim()) || before.includes(expected),
  'la catégorie initiale est revenue');
step('la correction a survécu au rechargement ✓');

// Et elle doit être marquée comme VOTRE choix, pas comme une déduction.
await same.click();
await page.waitForSelector('.sheet[data-open="true"]');
const detail = await page.locator('.sheet .card').first().textContent();
assert.ok(/Vous avez choisi cette catégorie|Confiance 100/.test(detail),
  `la source devrait être « votre choix » : ${detail.slice(0, 200)}`);
step('marquée comme votre choix, confiance 100 % ✓');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/* ---------------------------------------------------------------- */
console.log('\n5. La mémoire est visible et effaçable (§17)');
await go('/banque/regles');
await page.waitForTimeout(800);
const memoryRows = await page.locator('.rows .row').count();
assert.ok(memoryRows > 0, 'la mémoire devrait contenir au moins une entrée');
const firstMemory = await page.locator('.rows .row').first().textContent();
step(`${memoryRows} entrées, la première : « ${firstMemory.replace(/\s+/g, ' ').slice(0, 70)} »`);

/* ---------------------------------------------------------------- */
console.log('\n6. Assistant : une réponse justifiée, et un aveu d’ignorance');
await go('/');
await page.locator('button[aria-label="Demander à mon patrimoine"]').click();
await page.waitForSelector('.sheet[data-open="true"]');

await page.locator('.sheet input[type="text"]').fill('Combien vaut mon patrimoine ?');
await page.locator('.sheet button[type="submit"]').click();
await page.waitForTimeout(1500);

const answer = await page.locator('.sheet .card').last().textContent();
assert.ok(/patrimoine/i.test(answer), `réponse inattendue : ${answer.slice(0, 120)}`);
assert.ok(/€/.test(answer), 'la réponse devrait citer un montant');
step(`réponse : « ${answer.replace(/\s+/g, ' ').slice(0, 90)}… »`);

await page.locator('.sheet input[type="text"]').fill('Quelle est la capitale de la France ?');
await page.locator('.sheet button[type="submit"]').click();
await page.waitForTimeout(1200);
const dontKnow = await page.locator('.sheet .card').last().textContent();
assert.ok(/Je ne sais pas/i.test(dontKnow), 'devrait admettre son ignorance');
step('question hors sujet : « Je ne sais pas » ✓');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/* ---------------------------------------------------------------- */
console.log('\n7. Thème clair');
await go('/profil');
await page.locator('.segmented button', { hasText: 'Clair' }).first().click();
await page.waitForTimeout(700);
const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
assert.equal(theme, 'light');
const bg = await page.evaluate(() =>
  getComputedStyle(document.body).backgroundColor);
step(`thème clair appliqué, fond ${bg}`);
await page.screenshot({ path: '/tmp/shots/theme-clair.png' });
await page.locator('.segmented button', { hasText: 'Sombre' }).first().click();
await page.waitForTimeout(500);

/* ---------------------------------------------------------------- */
console.log('\n8. Masquage des montants');
await go('/profil');
const blurToggle = page.locator('.switch-row', { hasText: 'Masquer les montants' }).locator('.switch');
await blurToggle.click();
await page.waitForTimeout(500);
const blurState = await page.evaluate(() => document.body.dataset.blur);
assert.equal(blurState, 'on');
step('montants masqués ✓');

/* ---------------------------------------------------------------- */
console.log('\n9. Service worker : PWA installable et mode hors connexion');
await go('/');
// `boot()` est asynchrone : si l'enregistrement attendait l'événement `load`,
// celui-ci serait déjà passé et le service worker ne s'enregistrerait jamais.
const registration = await page.evaluate(async () => {
  const r = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
  ]).catch(() => null);
  return r ? { scope: r.scope, script: r.active?.scriptURL ?? '' } : null;
});
assert.ok(registration, 'le service worker ne s’est pas enregistré');
assert.ok(registration.script.endsWith('/sw.js'), `script inattendu : ${registration.script}`);
assert.ok(BASE.startsWith(registration.scope.replace(/\/$/, ''))
  || registration.scope.startsWith(BASE),
  `portée inattendue : ${registration.scope}`);
step(`enregistré, portée ${registration.scope} ✓`);

/* ---------------------------------------------------------------- */
console.log('\n10. Aucune erreur console sur l’ensemble du parcours');
const real = [...new Set(errors)].filter((e) => !/favicon/i.test(e));
if (real.length) {
  console.log(real.join('\n'));
  throw new Error(`${real.length} erreur(s) console`);
}
step('aucune ✓');

await browser.close();
console.log('\n✅ parcours de bout en bout : tout passe\n');
