import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';

import { LIVE_PAGE_JS } from './livePageJs';
import type { LiveCommand, LiveEvent, LiveSurfaceHandle, LiveSurfaceProps } from './surface';

type Engine = { command(m: LiveCommand): void; destroy(): void };
type TSTagLive = { loadLibs(origin: string): Promise<unknown>; create(root: HTMLElement, post: (m: LiveEvent) => void, opts: unknown): Engine };

/** プレイヤーのページの JS をこのページへ1回だけ入れる */
function ensureLive(): TSTagLive {
  const w = window as unknown as { TSTagLive?: TSTagLive };
  if (!w.TSTagLive) new Function(LIVE_PAGE_JS)();
  return w.TSTagLive!;
}

/** Web のライブ映像: このページの中で mpegts.js を動かす（元の Web 版と同じ） */
export const LiveSurface = forwardRef<LiveSurfaceHandle, LiveSurfaceProps>(function LiveSurface({ apiBase, channelId, quality, initial, onEvent, style }, ref) {
  // Web の View の ref は DOM の要素そのもの
  const root = useRef<HTMLElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const init = useRef(initial);
  init.current = initial;
  useImperativeHandle(ref, () => ({
    command: (c) => engine.current?.command(c),
  }), []);
  useEffect(() => {
    let dead = false;
    const live = ensureLive();
    live.loadLibs('').then(() => {
      const el = root.current;
      if (dead || !el) return;
      engine.current = live.create(el, (m) => cb.current(m), { apiBase, channelId, quality, ...init.current });
    }).catch((e: unknown) => cb.current({ type: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => { dead = true; engine.current?.destroy(); engine.current = null; };
  }, [apiBase, channelId, quality]);
  return <View ref={root as never} style={style} />;
});
