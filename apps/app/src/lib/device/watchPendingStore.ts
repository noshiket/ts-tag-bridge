// 送れていない視聴位置の置き場（Web はブラウザの保存。元の Web 版の WatchStore のフォールバックと同じ）
const KEY = 'tstag_watch_pending';

export function readPending(): Record<string, unknown> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>; } catch { return {}; }
}

export function writePending(v: Record<string, unknown>) {
  try {
    if (!Object.keys(v).length) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* 置けなくても再生は続ける */ }
}
