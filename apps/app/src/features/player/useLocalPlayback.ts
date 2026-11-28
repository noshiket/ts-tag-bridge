import { confirmedFromTag, sidecarComments, targetKey } from '@tstag/core';
import { useApi, queryKeys } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { LocalBundle } from '../../lib/localSave/backend.types';
import { localSave } from '../../lib/localSave/store';
import type { WatchParams } from '../../lib/playback/miniPlayer';

type State = { status: 'none'; bundle: null } | { status: 'loading'; bundle: null } | { status: 'missing'; bundle: null } | { status: 'ready'; bundle: LocalBundle };

/**
 * 端末に保存した分を再生する時（local=1、または保存済み）: 保存を読み、保存した補助データ（番組情報・実況・ドロップ・字幕）を
 * サーバーから読んだ物として先に置く。通信が無くても再生画面がそのまま使える（元の Web 版のローカル再生と同じ）。
 * 保存に添えた tag.json からは、タブの確定値・チャプターを先に置く。通信があれば tag.json を取り直して添え直す
 */
export function useLocalPlayback(params: WatchParams): State {
  const qc = useQueryClient();
  const api = useApi();
  const id = Number(params.id);
  const node = params.node ?? null;
  // 入口が local=1 を付け忘れても（続きから・録画詳細・キャプチャ一覧など）、保存してあれば保存から
  const want = params.kind !== 'rec' && (params.local === '1' || localSave.isSaved(id, node));
  const [st, setSt] = useState<State>(want ? { status: 'loading', bundle: null } : { status: 'none', bundle: null });
  useEffect(() => {
    if (!want) { setSt({ status: 'none', bundle: null }); return; }
    let dead = false;
    let got: LocalBundle | null = null;
    setSt({ status: 'loading', bundle: null });
    localSave.read(id, node).then((b) => {
      if (dead) { b?.release(); return; }
      if (!b) { setSt({ status: 'missing', bundle: null }); return; }
      got = b;
      const k = targetKey({ kind: 'vdb', id });
      const sc = b.sidecar;
      if (sc.metadata) qc.setQueryData(queryKeys.streamMeta(k, node), sc.metadata);
      // 主のトラックと、外から取り込んだ追加のトラック（保存した答えのまま）
      qc.setQueryData(queryKeys.comments(k, node), sidecarComments(sc));
      if (sc.drops) qc.setQueryData(queryKeys.marks(k, node), sc.drops);
      for (const [track, caps] of Object.entries(sc.captions)) qc.setQueryData(queryKeys.captions(k, track, node), caps);
      setSt({ status: 'ready', bundle: b });
      void localSave.readJson(id, node, 'tag').then((tag) => { if (!dead && tag) seedTag(qc, id, node, tag as Record<string, unknown>); });
      // 通信があれば今の tag.json を添え直す（前の保存に無い分もここで添わる）
      void api.videoActions.tag(id, node).then((r) => { if (r.exists && r.tag) void localSave.saveJson(id, node, 'tag', r.tag); }).catch(() => {});
    }).catch(() => { if (!dead) setSt({ status: 'missing', bundle: null }); });
    return () => { dead = true; got?.release(); };
  }, [want, id, node, qc]);
  return st;
}

/** tag.json から、確定値タブ（/confirmed の答え）とチャプタータブ（/tag の答え）を先に置く。通信があればそれぞれ取り直して置き換わる */
function seedTag(qc: ReturnType<typeof useQueryClient>, id: number, node: string | null, tag: Record<string, unknown>) {
  const k = node ?? '';
  if (!qc.getQueryData(['videoTag', k, id])) qc.setQueryData(['videoTag', k, id], { tag, exists: true });
  if (!qc.getQueryData(['videoConfirmed', k, id])) qc.setQueryData(['videoConfirmed', k, id], confirmedFromTag(tag));
}
