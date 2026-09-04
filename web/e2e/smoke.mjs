/**
 * Smoke E2E against the built demo (web/dist) served under /quiz/ like GitHub Pages.
 * Run: node web/e2e/smoke.mjs   (expects `npm run build --workspace=web` with VITE_DEMO=1 VITE_BASE=/quiz/)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/quiz\/?/, '') || 'index.html';
  let file = join(ROOT, p);
  let body;
  try { body = await readFile(file); } catch { file = join(ROOT, 'index.html'); body = await readFile(file); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(8899, r));

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? '✓' : '✗'} ${msg}`); };
// CI: `playwright install chromium`; locally you may point at a system Chromium.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
for (const [name, viewport, arabic] of [['mobile-ar', { width: 375, height: 720 }, true], ['desktop-en', { width: 1200, height: 800 }, false]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/googleapis|ERR_FAILED|ERR_CONNECTION/.test(m.text())) errors.push(m.text()); });
  await page.route(/^(?!http:\/\/localhost).*/, (r) => r.abort());
  await page.goto('http://localhost:8899/quiz/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  if (arabic) { await page.getByText('ع', { exact: true }).first().click(); await page.waitForTimeout(400); }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow === 0, `${name}: no horizontal overflow (${overflow}px)`);
  check((await page.locator('.hero').count()) > 0, `${name}: home hero renders`);
  await page.getByRole('link', { name: arabic ? /العب/ : 'Play' }).first().click();
  await page.waitForTimeout(500);
  check((await page.locator('button:has-text("🧘")').count()) > 0, `${name}: play page shows modes`);
  await page.getByRole('button', { name: arabic ? /ابدأ الاختبار/ : /Start Quiz/ }).first().click();
  await page.waitForTimeout(900);
  check((await page.locator('.quiz-question').count()) > 0, `${name}: a question renders`);
  // the bank is shuffled: skip non-choice questions until one with options shows up, then answer it
  let answered = false;
  for (let i = 0; i < 6 && !answered; i++) {
    const opt = page.locator('.option').first();
    if (await opt.count()) {
      await opt.click();
      const submit = page.getByRole('button', { name: arabic ? /^إرسال/ : /^Submit/ }).first();
      await submit.waitFor({ state: 'visible', timeout: 3000 });
      if (await submit.isEnabled()) {
        await submit.click();
        await page.locator('.feedback').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
        answered = (await page.locator('.feedback').count()) > 0;
        break;
      }
      // composite / multi-part question: one option is not a full answer — move on
    }
    const skip = page.getByRole('button', { name: arabic ? /^تخط/ : /^Skip/ }).first();
    if (!(await skip.count())) break;
    await skip.click();
    await page.waitForTimeout(600);
  }
  check(answered, `${name}: practice feedback appears after answering`);
  check(errors.length === 0, `${name}: no JS/console errors${errors.length ? ' — ' + errors.join(' | ') : ''}`);
  await page.close();
}
const manifest = await new Promise((r) => http.get('http://localhost:8899/quiz/manifest.webmanifest', (res) => r(res.statusCode)));
check(manifest === 200, 'manifest served');
await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} smoke check(s) failed`); process.exit(1); }
console.log('\nsmoke OK');
