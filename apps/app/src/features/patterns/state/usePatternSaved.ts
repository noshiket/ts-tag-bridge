import type { PeerSync } from '@tstag/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useT } from '../../../ui/i18n/I18n';

/**
 * パターンを保存した後の後始末: 連携先へ届かなかったら知らせる（後でサーバーが送り直す）・解析プレビューを取り直させる。
 * 取り直させないと、録画詳細・予約詳細に戻っても古いパターンでの当たり方が出たままになる（30 秒は覚えている）
 */
export function usePatternSaved() {
  const { t: tx } = useT();
  const qc = useQueryClient();
  const [peerSyncMsg, setPeerSyncMsg] = useState<string | null>(null);
  const patternSaved = (r: PeerSync | undefined) => {
    void qc.invalidateQueries({ queryKey: ['parsePreview'] });
    const failed = Object.entries(r?.peer_sync ?? {}).filter(([, v]) => v !== 'ok');
    // 届かなかった分はサーバーが覚えていて、つながったら順に送り直す（'queued: …'）
    if (failed.length) { setPeerSyncMsg(tx('patterns.usePatternSaved.couldntReachWillResend', { v0: failed.map(([n]) => n).join(', ') })); setTimeout(() => setPeerSyncMsg(null), 5000); }
  };
  return { peerSyncMsg, patternSaved };
}
