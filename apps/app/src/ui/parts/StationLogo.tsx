import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { useState } from 'react';

import { T } from './T';

/**
 * 局のロゴ。高さに合わせ、幅は画像の縦横比で決める（maxWidth まで。元の Web 版の img と同じ）。
 * ロゴの無い局は name を出す（name が無ければ何も出さない）
 */
export function StationLogo({ onid, sid, name, height = 14, maxWidth = 42 }: {
  onid: number;
  sid: number;
  name?: string | null;
  height?: number;
  maxWidth?: number;
}) {
  const api = useApi();
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(maxWidth);
  if (failed) return name ? <T mono size={9} dim>{name}</T> : null;
  return (
    <Image source={{ uri: api.client.url(`/api/logo?onid=${onid}&sid=${sid}&v=3`), headers: api.client.authHeaders() }}
      style={{ height, width }} contentFit="contain" cachePolicy="memory-disk" onError={() => setFailed(true)}
      onLoad={(e) => e.source.height && setWidth(Math.min(maxWidth, (height * e.source.width) / e.source.height))} />
  );
}
