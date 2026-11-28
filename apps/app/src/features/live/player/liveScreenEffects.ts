import type { LiveChannel } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { miniPlayer } from '../../../lib/playback/miniPlayer';
import type { LiveSurfaceHandle } from '../surface';

/** 操作の表示を消すまでの時間（放送中だけ。元と同じ 3 秒） */
const HIDE_MS = 3000;

/** 操作の表示: 触ると出て、放送中なら少しして消える。放送中でない間は出したまま */
export function useLiveControlsVisible(onAir: boolean) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), HIDE_MS);
  }, []);
  useEffect(() => {
    if (onAir) bump();
    else { setVisible(true); if (timer.current) clearTimeout(timer.current); }
  }, [onAir, bump]);
  return { visible, setVisible, bump };
}

/** 下のミニプレイヤーへ（ライブは送りを付けない。チューナーを掴み直すことになるため。元と同じ） */
export function useLiveMiniPlayer(channel: LiveChannel, paused: boolean, surface: RefObject<LiveSurfaceHandle | null>) {
  const api = useApi();
  const channelId = channel.display_channel_id;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    miniPlayer.publish({
      kind: 'live', title: channel.service_name || channelId, episodeNum: '', episodeName: '',
      thumb: { uri: api.client.url(`/api/logo?onid=${channel.network_id}&sid=${channel.service_id}&v=3`), headers: api.client.authHeaders() },
      playing: !paused, canNext: false,
      toggle: () => surface.current?.command({ type: pausedRef.current ? 'play' : 'pause' }),
      next: () => {},
    });
  }, [channel, channelId, paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => miniPlayer.clear('live'), []);
}
