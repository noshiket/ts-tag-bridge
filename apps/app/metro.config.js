// Web 版の開発中だけ、/api（とライブのプレイヤーが読む /vendor の mpegts.js などと /src/jikkyo.jsx）をサーバーへ中継する。本番の Web 版はサーバーが配るので
// 同じ場所になるが、開発中は Metro(8081) とサーバー(8092) で場所が違い、Cookie が届かない。
// 中継先は TSTAG_API で変えられる（既定は手元のサーバー）。
const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const target = new URL(process.env.TSTAG_API || 'http://127.0.0.1:8092');

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => (req, res, next) => {
    const proxied = req.url.startsWith('/api/') || req.url.startsWith('/vendor/') || req.url.startsWith('/src/jikkyo.jsx');
    if (!proxied) return metroMiddleware(req, res, next);
    const upstream = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `サーバーに届きません: ${e.message}` }));
    });
    req.pipe(upstream);
  },
};

module.exports = config;
