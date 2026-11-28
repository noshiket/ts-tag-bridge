import type { PatternCtx, StreamMeta } from '@tstag/core';
import { useMemo } from 'react';

import { PatternEditor } from '../../patterns/PatternEditor';

/** 再生画面の「パターン」（元の stream_right_tab_pattern.jsx）。中身はパターン画面と同じ編集 */
export function PatternTab({ meta, videoId }: { meta: StreamMeta | undefined; videoId: number }) {
  const ctx: PatternCtx | null = useMemo(() => (meta ? {
    id: String(videoId), title: meta.title || '', service_name: meta.station_name || '', sid: meta.sid ?? undefined, onid: meta.onid ?? undefined,
    tsid: meta.tsid ?? undefined, start: meta.start_time || '', description: meta.description || '', extended_info: meta.extended_info || '',
  } : null), [meta, videoId]);
  return <PatternEditor ctx={ctx} />;
}
