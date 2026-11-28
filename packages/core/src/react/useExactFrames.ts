// Amatsukaze の厳密なコマ番号（元の split_editor.jsx の useExactFrames）。
// 指した時刻だけをサーバーの /frames（明示 PTS 表の二分探索）で引く。表を作っている間は待って取り直し、
// 対応していない録画（H.264 など）は近い値のまま止める
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useApi } from './context';

export type ExactStatus = 'ready' | 'building' | 'unsupported' | null;

export function useExactFrames(dbRecId: number | null, node: string | null, times: (number | null | undefined)[]) {
  const api = useApi();
  const [map, setMap] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<ExactStatus>(null);
  const key = useMemo(() => [...new Set(times.filter((t): t is number => t != null).map((t) => Number(t).toFixed(3)))].sort().join(','), [times]);
  useEffect(() => {
    if (!dbRecId || !key) { setStatus(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const uniq = key.split(',').map(Number);
    const poll = async () => {
      try {
        const res = await api.recordings.frames(dbRecId, uniq, node);
        if (cancelled) return;
        if (res.ready) {
          const m: Record<string, number> = {};
          uniq.forEach((t, i) => { const f = res.frames?.[i]; if (f != null) m[t.toFixed(3)] = f; });
          setMap(m); setStatus('ready');
        } else if (res.unsupported || res.error) {
          setStatus('unsupported');
          void api.settings.clientError('厳密フレーム: サーバーが非対応と回答', { recId: dbRecId, node: node || null, res }).catch(() => {});
        } else {
          setStatus('building');
          timer = setTimeout(() => void poll(), 3000);
        }
      } catch (e) {
        // 「近似」の表示になった理由が画面に出ないので、サーバーのログへ残す（元と同じ）
        if (!cancelled) {
          setStatus('unsupported');
          void api.settings.clientError(`厳密フレーム取得に失敗: ${e instanceof Error ? e.message : String(e)}`, { recId: dbRecId, node: node || null, count: uniq.length }).catch(() => {});
        }
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, dbRecId, key, node]);
  const exactFrame = useCallback((t: number | null | undefined) => (t == null ? null : map[Number(t).toFixed(3)] ?? null), [map]);
  return { exactFrame, status };
}
