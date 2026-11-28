// 前の Web 版が入れていた Service Worker を片付けるためだけのもの。
//
// 前の Web 版は、読んだ画面のファイルを端末にためて、通信なしでも開けるようにしていた。
// 今の Web 版（apps/app）は Service Worker を使わないが、前の Web 版を開いたことのある端末には
// 古い物が残り、ためた画面を出し続けることがある。ブラウザは時々 /sw.js を取り直すので、
// これに差し替わった時点で、ためた物を消して自分を外し、開いている画面を読み直させる。
// （今の Web 版の端末への保存は IndexedDB なので、ここで消す Cache Storage とは別）

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
