// ライブのページの JavaScript の一部: 読み込み（IIFE の始まり・バッファの目標・ライブラリの読み込み）。
// livePageJs.ts がこの順につないで1つにする（関数の途中では切っていない。中で ` と ${ を使わないこと）

export const PART = String.raw`
(function () {
  'use strict';
  if (window.TSTagLive) return;

  // 再生前に貯める/保つバッファの目標秒（KonomiTV: 通常 4.0、Safari は揺らぎ対策で +0.3）
  var IS_SAFARI = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  var LIVE_BUFFER_SEC = IS_SAFARI ? 4.3 : 4.0;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error(src + ' を読めません')); };
      document.head.appendChild(s);
    });
  }
  // jikkyo.jsx は中身が素の JS だが、拡張子のせいで script として読めない環境があるので取って評価する
  function loadText(src) {
    return fetch(src, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error(src + ' を読めません (' + r.status + ')');
      return r.text();
    }).then(function (t) { (0, eval)(t); });
  }
  var libs = null;
  function loadLibs(origin) {
    if (libs) return libs;
    var o = origin || '';
    libs = Promise.all([
      window.mpegts ? null : loadScript(o + '/vendor/mpegts.js'),
      window.aribb24js ? null : loadScript(o + '/vendor/aribb24.umd.js'),
      window.Danmaku ? null : loadScript(o + '/vendor/danmaku.min.js'),
      window.LiveCommentManager ? null : loadText(o + '/src/jikkyo.jsx'),
    ]);
    return libs;
  }

`;
