import { useEffect } from 'react';

// 画面の端（iPhone の時計の下・Safari の下のボタンの裏）まで使う（元の app.html と同じ viewport-fit=cover）。
// 時計やボタンと重なる分は、各画面の安全な余白（safe area）がよける
if (typeof document !== 'undefined') {
  const meta = document.querySelector('meta[name="viewport"]');
  const content = meta?.getAttribute('content') ?? '';
  if (meta && !/viewport-fit/.test(content)) meta.setAttribute('content', `${content}, viewport-fit=cover`);
}

// ホーム画面に追加すると、Safari のバー無しの全画面で開く（元の Web 版と同じ /manifest.json。サーバーが配る）。
// 上の時計の帯は透かして、画面の安全な余白でよける
if (typeof document !== 'undefined') {
  const add = (tag: string, attrs: Record<string, string>) => {
    const sel = `${tag}[${Object.entries(attrs).slice(0, 1).map(([k, v]) => `${k}="${v}"`).join('')}]`;
    if (document.head.querySelector(sel)) return;
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
  };
  add('link', { rel: 'manifest', href: '/manifest.json' });
  add('link', { rel: 'apple-touch-icon', href: '/icon-192.png' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
}

/**
 * ページの地の色と、ブラウザが上下の帯に使う色（theme-color）をテーマの背景に合わせる。
 * 合わせないと、Safari の上下に地の白が出る（元の Web 版は地を暗い色にしている）
 */
export function usePageColor(bg: string) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.backgroundColor = bg;
    document.body.style.backgroundColor = bg;
    let tc = document.querySelector('meta[name="theme-color"]');
    if (!tc) { tc = document.createElement('meta'); tc.setAttribute('name', 'theme-color'); document.head.appendChild(tc); }
    tc.setAttribute('content', bg);
  }, [bg]);
}
