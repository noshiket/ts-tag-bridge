import type { AmzDisk, AmzProfile, AmzSystem } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useCallback, useEffect, useState } from 'react';

import { useViewNode } from '../../../lib/state/viewNode';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 見ているサーバーの Amatsukaze の接続先・状態・ディスク・プロファイル。
 * 10秒で答えが無ければ失敗にする（元と同じ）。サーバーを切り替えたら取り直す
 */
export function useAmzStatus() {
  const { t: tx } = useT();
  const api = useApi();
  const { viewNode } = useViewNode();
  const [system, setSystem] = useState<AmzSystem | null>(null);
  const [disks, setDisks] = useState<AmzDisk[]>([]);
  const [profiles, setProfiles] = useState<AmzProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [amzUrl, setAmzUrl] = useState('');

  useEffect(() => { api.settings.config(viewNode).then((c) => setAmzUrl(typeof c.amatsukaze_url === 'string' ? c.amatsukaze_url : '')).catch(() => {}); }, [api, viewNode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(tx('settings.useAmzStatus.connectionTimedOut10s'))), 10_000));
    try {
      const [sys, dsk, prof] = await Promise.race([Promise.all([api.amatsukaze.system(viewNode), api.amatsukaze.disks(viewNode), api.amatsukaze.profiles(viewNode)]), timeout]);
      setSystem(sys);
      setDisks(Array.isArray(dsk) ? dsk : []);
      setProfiles(Array.isArray(prof) ? prof.map((p) => (typeof p === 'string' ? { name: p } : p)) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, viewNode]);
  useEffect(() => { void load(); }, [load]);

  const paused = system?.state?.pause ?? false;
  const togglePause = async () => {
    try { await api.amatsukaze.pause(!paused, viewNode); setSystem(await api.amatsukaze.system(viewNode)); } catch { /* 元と同じく黙る */ }
  };
  return { amzUrl, disks, profiles, setProfiles, loading, error, paused, load, togglePause };
}
