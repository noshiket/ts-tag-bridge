// Web 版で、設定 → アプリ → 開発者向け → 「API の一覧」を開き、絞り込みと行を開くところまで確かめる（読むだけ）。
//
// 先に `npm run web -w @tstag/app`（開発サーバー :8095）と本体のサーバー(:8092)を動かしておく。
// usage: node apps/app/e2e/web-api-docs.mjs http://127.0.0.1:8095 "$(server/.venv/bin/python apps/app/e2e/app_token.py)" /tmp/out
import { chromium } from 'playwright';
const [,, base, token, out] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 });
await ctx.addCookies([{ name: 'ea_token', value: token, url: base }]);
const p = await ctx.newPage();
const logs = [];
p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const fail = (m) => { console.log('NG', m, logs); process.exitCode = 1; };

await p.goto(base + '/settings');
await p.getByText('アプリ', { exact: true }).first().click();
const link = p.getByText('API の一覧', { exact: true });
await link.scrollIntoViewIfNeeded();
await link.click();
await p.getByText(/^\d+ 件$/).waitFor({ timeout: 20000 });
const all = await p.getByText(/^\d+ 件$/).innerText();
await p.screenshot({ path: `${out}/api-docs-1-list.png` });

await p.getByPlaceholder(/URL・説明・メソッドで絞る/).fill('encode sync');
await p.waitForTimeout(300);
const narrowed = await p.getByText(/^\d+ 件$/).innerText();
await p.getByText('/api/encode/sync', { exact: true }).click();
await p.getByText(/api\.encode_routes\./).first().waitFor({ timeout: 5000 });
await p.screenshot({ path: `${out}/api-docs-2-open.png` });

console.log('all:', all, ' narrowed:', narrowed, ' url:', p.url());
if (parseInt(narrowed) >= parseInt(all)) fail('絞り込みで減らない');
if (logs.length) fail('ページのエラー');
await browser.close();
