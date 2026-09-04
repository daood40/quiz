/**
 * Full-stack E2E: real API + PostgreSQL + built SPA served by the server.
 * Run: BASE_URL=http://127.0.0.1:3001 node web/e2e/fullstack.mjs
 * Expects the server started with SEED_ON_BOOT=true and SEED_ADMIN_PASSWORD='ChangeMe123!'.
 */
import { chromium } from 'playwright';

const B = process.env.BASE_URL ?? 'http://127.0.0.1:3001';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/googleapis|ERR_FAILED|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
const origin = new URL(B).origin;
await page.route((url) => !url.href.startsWith(origin), (r) => r.abort());

// register
await page.goto(`${B}/register`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const u = `e2e${Date.now().toString(36)}`;
await page.locator('input[type=email]').fill(`${u}@example.com`);
await page.locator('input:not([type=email]):not([type=password])').first().fill(u);
const pws = page.locator('input[autocomplete=new-password]');
await pws.nth(0).fill('Passw0rd123!');
await pws.nth(1).fill('Passw0rd123!');
await page.locator('form button.btn:not(.secondary):not(.ghost)').first().click();
await page.waitForTimeout(1500);
check(!page.url().includes('/register') && (await page.locator('.hero').count()) > 0, 'register → logged in → home renders');

// ranked (timed) round from the real API
await page.goto(`${B}/play`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.locator('main button').filter({ hasText: /^⚡/ }).first().click();
await page.getByRole('button', { name: /Start Quiz/ }).first().click();
await page.waitForTimeout(1500);
check((await page.locator('.quiz-question').count()) > 0, 'timed round starts');
let answered = 0, skipped = 0;
for (let i = 0; i < 20; i++) {
  if ((await page.getByRole('button', { name: /Review Answers|Try Again/ }).count()) > 0) break;
  const opt = page.locator('.option').first();
  if (await opt.count()) {
    await opt.click(); await page.waitForTimeout(300);
    const s = page.getByRole('button', { name: /^Submit/ }).first();
    if ((await s.count()) && (await s.isEnabled())) { await s.click(); answered++; }
  } else {
    const sk = page.getByRole('button', { name: /^Skip/ }).first();
    if ((await sk.count()) && (await sk.isEnabled())) { await sk.click(); skipped++; }
  }
  await page.waitForTimeout(700);
}
check((await page.getByRole('button', { name: /Review Answers/ }).count()) > 0 && answered + skipped >= 10, `round completes (answered ${answered}, skipped ${skipped})`);

// leaderboard shows the player
await page.goto(`${B}/leaderboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
check((await page.locator('tr.me').count()) === 1, 'leaderboard lists the player after a ranked round');

// pages render without horizontal overflow on a phone
for (const path of ['/stats', '/achievements', '/', '/leaderboard']) {
  await page.goto(`${B}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow === 0, `${path}: no horizontal overflow (${overflow}px)`);
}

// seeded super admin can open the admin panel
await page.evaluate(() => localStorage.clear());
await page.goto(`${B}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.locator('#ident').fill('admin');
await page.locator('#pw').fill(ADMIN_PW);
await page.locator('form button.btn:not(.secondary):not(.ghost)').first().click();
await page.waitForTimeout(1500);
await page.goto(`${B}/admin`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
check(page.url().includes('/admin') && (await page.locator('main').innerText()).length > 50, 'admin panel opens for the seeded super admin');
await page.goto(`${B}/admin/users`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const adminOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(adminOverflow === 0, `/admin/users: no horizontal overflow (${adminOverflow}px)`);

check(errors.length === 0, `no JS/console errors${errors.length ? ' — ' + errors.join(' | ') : ''}`);
await browser.close();
if (failures.length) { console.error(`\n${failures.length} full-stack check(s) failed`); process.exit(1); }
console.log('\nfull-stack OK');
