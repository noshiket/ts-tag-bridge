import { buildScreenGroups, layoutDanmaku, posToTot, type CaptionEntry, type Comment, type StreamMeta } from '@tstag/core';
import { queryKeys, useApi } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import type { RefObject } from 'react';

import { fitVideoRect } from './overlays/VideoRect';
import { composeCapture } from './capture';
import type { CaptureOptions, CaptureResult } from './tabs/CaptureTab';
import type { VideoSurfaceHandle } from './surface';
import { useT } from '../../ui/i18n/I18n';

/**
 * 今のコマを撮って保存する（元の Web 版の captureScreenshot と同じ中身）。
 * 弾幕・字幕は画面に出している時だけ重ねる。位置は放送時刻(tot)で残す（一覧の「ここから」用）
 */
export function useTakeCapture(p: {
  videoId: number;
  /** 録画を再生している時 */
  rec?: boolean;
  meta: StreamMeta | undefined;
  title: string;
  surface: RefObject<VideoSurfaceHandle | null>;
  /** 映像を出している枠の大きさ（弾幕・字幕はこの座標） */
  stage: RefObject<{ width: number; height: number }>;
  /** 映像の縦横比（幅 ÷ 高さ） */
  aspect: number;
  /** 画面に流しているコメント・字幕（出していなければ null） */
  comments: Comment[] | null;
  captions: CaptionEntry[] | null;
  /** 弾幕の表示の設定（画面と同じにする） */
  danmaku: { opacity: number; scale: number; maxOnScreen: number };
}) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  return async ({ includeComment, includeCaption }: CaptureOptions): Promise<CaptureResult> => {
    // 弾幕は映像の枠（VideoRect）に流しているので、写す時も同じ枠で並べる
    const stage = fitVideoRect(p.stage.current.width, p.stage.current.height, p.aspect);
    const danmakuLayout = includeComment && p.comments
      ? layoutDanmaku(p.comments, stage.width, stage.height, { scale: p.danmaku.scale, maxOnScreen: p.danmaku.maxOnScreen })
      : null;
    let image: string;
    let time: number;
    const native = p.surface.current?.captureImage;
    if (native) {
      // iOS: 小窓へ送っているコマに、画面と同じ弾幕・字幕を iOS の部品で重ねる
      const shot = await native({
        danmaku: danmakuLayout ? JSON.stringify(danmakuLayout) : null, opacity: p.danmaku.opacity,
        stageWidth: stage.width, stageHeight: stage.height, includeCaption: includeCaption && !!p.captions,
      }).catch(() => null);
      if (!shot) return { ok: false, error: tx('live.useTakeCapture.noVideo') };
      ({ image, time } = shot);
    } else {
      const frame = await p.surface.current?.grabFrame();
      if (!frame) return { ok: false, error: tx('live.useTakeCapture.noVideo') };
      time = frame.time;
      try {
        image = await composeCapture(frame, stage, {
          danmaku: danmakuLayout ? { layout: danmakuLayout, opacity: p.danmaku.opacity } : null,
          captions: includeCaption && p.captions ? buildScreenGroups(p.captions) : null,
        });
      } catch {
        return { ok: false, error: tx('player.useTakeCapture.imageGenerationFailed') };
      }
    }
    const totMs = p.meta ? posToTot(p.meta, time) : null;
    try {
      const r = await api.stream.saveCapture({
        image, station: p.title || `${p.rec ? 'rec' : 'vdb'}:${p.videoId}`, channel_id: `${p.rec ? 'rec' : 'vdb'}${p.videoId}`,
        tot: totMs != null ? new Date(totMs).toISOString() : null,
      });
      if (!r.ok) return { ok: false, error: r.error || tx('common.saveFailed2') };
      if (p.meta?.album_id != null) void qc.invalidateQueries({ queryKey: queryKeys.albumCaptures(p.meta.album_id, null) });
      return { ok: true, file: r.file ?? '' };
    } catch {
      return { ok: false, error: tx('common.saveRequestFailed') };
    }
  };
}
