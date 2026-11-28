// Web 版を本物のブラウザ(Chromium)で、画面と同じ経路で確かめる。
//   1. ログインしていない → ログイン画面。間違ったパスワードで理由が出る
//   2. ログイン済み → ライブラリ → 絞り込み → アルバム → 戻る
//
// 先に `npm run web -w @tstag/app`（開発サーバー :8095）と本体のサーバー(:8092)を動かしておく。
// ログインは短命の JWT を Cookie に入れて行う（設定は書き換えない）。
//
// usage: node apps/app/e2e/web-library.mjs http://127.0.0.1:8095 "$(server/.venv/bin/python apps/app/e2e/app_token.py)" /tmp/out
//   playwright は npx playwright install chromium-headless-shell で入れる
import { chromium } from 'playwright';
const [,, base, token, out] = process.argv;
const browser = await chromium.launch();
const logs = [];
async function page(withCookie, w = 1280, h = 860) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (withCookie) await ctx.addCookies([{ name: 'ea_token', value: token, url: base }]);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  return p;
}
// 1. ログインしていない → ログイン画面。間違ったパスワードでエラーが出る
let p = await page(false);
await p.goto(base, { waitUntil: 'networkidle' });
await p.getByText('ログイン').last().waitFor({ timeout: 60000 });
await p.screenshot({ path: `${out}/login.png` });
const inputs = p.locator('input');
console.log('login inputs', await inputs.count());
await inputs.nth(0).fill('no-such-user');
await inputs.nth(1).fill('wrong');
await p.getByText('ログイン').last().click();
await p.getByText('ユーザー名またはパスワードが違います').waitFor({ timeout: 15000 });
console.log('bad login shows error: ok');
// 2. ログイン済み → ライブラリ → 絞込 → アルバム → 戻る
p = await page(true, 430, 900);
const t0 = Date.now();
await p.goto(base, { waitUntil: 'domcontentloaded' });
await p.getByText('// LIBRARY').waitFor({ timeout: 60000 });
const cards = p.getByText(/本 · 最終/).filter({ visible: true });
await cards.first().waitFor({ timeout: 30000 });
console.log('library shown in', Date.now() - t0, 'ms, cards', await cards.count());
await p.screenshot({ path: `${out}/library.png` });
await p.getByText('絞込', { exact: true }).click();
await p.getByPlaceholder('タイトルで絞り込み').fill('ポコロ');
await p.waitForTimeout(500);
const n = await cards.count();
console.log('after filter', n);
if (n < 1) throw new Error('絞り込みで1件も出ない');
await p.getByText('ポコロ隊長☆', { exact: true }).first().click();
await p.getByText('// ALBUM').waitFor({ timeout: 30000 });
const plays = p.getByText('▶ 再生').filter({ visible: true });
await plays.first().waitFor({ timeout: 30000 });
await p.screenshot({ path: `${out}/album.png` });
console.log('album url', p.url(), 'video cards', await plays.count());
await p.getByText('戻る', { exact: true }).first().click();
await p.getByText('// LIBRARY').filter({ visible: true }).waitFor({ timeout: 10000 });
console.log('back ok');
console.log('--- console ---\n' + logs.slice(0, 20).join('\n'));
await browser.close();
