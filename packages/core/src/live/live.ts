// ライブ視聴（元の live.jsx の LiveScreen と番組情報の計算）。再生そのものは mpegts.js でアプリ側
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';

/** チューナーの局（GET /api/streams/channels） */
export interface LiveChannel { display_channel_id: string; channel_type: string; network_id: number; service_id: number; transport_stream_id: number; service_name: string }
/** 配信の状態（/events の SSE）。client_count は見ている人数 */
export interface LiveStatus { status: 'Offline' | 'Standby' | 'ONAir' | 'Idling' | 'Restart' | string; detail?: string; client_count?: number }
/** iOS の小窓に焼き込む字幕・実況（GET .../hls/overlays。時刻はどちらも UNIX 秒） */
export interface LiveOverlays {
  now: number;
  jikkyo: boolean;
  /** 録画の captions-data と同じ形（pts が UNIX 秒） */
  captions: { pts: number; tokens: unknown[]; duration_ms: number | null; clear_screen: boolean | null }[];
  /** 録画のコメントと同じ形（time が UNIX 秒） */
  comments: { time: number; text: string; color: string; type: string; size: string; user_id?: string | null; premium?: unknown }[];
}
/** 実況コメント1件（NX-Jikkyo） */
export interface LiveComment { id: number; text: string; time: string; color: string; position: string; size: string; user_id?: string; premium?: unknown; my_post?: boolean }
/** 放送中の番組（GET /api/epg?service=&onair=1。0番目が今、1番目が次） */
export interface OnairEvent { title: string; description?: string; extended_info?: string; start_time: string; duration_sec: number; genre?: string; has_secondary_audio?: boolean }

/** 画質（元の QUALITIES。hevc は H.265） */
export const LIVE_QUALITIES = [
  '1080p-60fps', '1080p-60fps-hevc', '1080p', '1080p-hevc', '810p', '810p-hevc', '720p', '720p-hevc',
  '540p', '540p-hevc', '480p', '480p-hevc', '360p', '360p-hevc', '240p', '240p-hevc',
] as const;
export const STATUS_COLORS: Record<string, string> = { Offline: '#666', Standby: '#f59e0b', ONAir: '#10b981', Idling: '#3b82f6', Restart: '#ef4444' };

/**
 * 番組表の局から、ライブで見る局を決める。チューナーの局表は主の SID だけなので、
 * サブチャンネルの番組は SID が一致しない → 同じ局（network_id）の主チャンネルへ回す（元と同じ）
 */
export function resolveLiveChannel(list: LiveChannel[], sid: number, onid: number): LiveChannel | null {
  return list.find((c) => c.service_id === sid && c.network_id === onid) ?? list.find((c) => c.network_id === onid) ?? null;
}

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 放送中の番組の進み（バーの割合・残り分・開始/終了/次の時刻） */
export function liveProgress(cur: OnairEvent | null, next: OnairEvent | null, now = Date.now()) {
  if (!cur) return null;
  const start = Date.parse(cur.start_time);
  const end = start + (cur.duration_sec || 0) * 1000;
  const progPct = end > start ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100)) : 0;
  return { progPct, remainMin: Math.max(0, Math.ceil((end - now) / 60000)), startStr: hm(start), endStr: hm(end), nextStr: next ? hm(Date.parse(next.start_time)) : '' };
}

export const liveApi = (c: ApiClient) => ({
  channels: (node?: string | null) => c.get<LiveChannel[]>(nodePath(node, '/api/streams/channels')),
  onair: (ch: Pick<LiveChannel, 'network_id' | 'transport_stream_id' | 'service_id'>, node?: string | null) =>
    c.get<OnairEvent[]>(nodePath(node, `/api/epg?service=${ch.network_id}-${ch.transport_stream_id}-${ch.service_id}&onair=1`)),
  /** ライブの HLS（iOS の小窓用）。再生器に渡すので URL で返す */
  hlsUrl: (channelId: string, quality: string, node?: string | null) =>
    c.url(nodePath(node, `/api/streams/live/${channelId}/${quality}/hls/playlist.m3u8`)),
  overlays: (channelId: string, quality: string, since: number, node?: string | null) =>
    c.get<LiveOverlays>(nodePath(node, `/api/streams/live/${channelId}/${quality}/hls/overlays?since=${since}`)),
  /** 小窓の用意をやめる（チューナーを早く他へ回せるように） */
  stopHls: (channelId: string, quality: string, node?: string | null) =>
    c.delete<{ ok: boolean }>(nodePath(node, `/api/streams/live/${channelId}/${quality}/hls`)),
  /** プレイヤーのページが使う API の場所（他のサーバーのチューナーは中継を通す） */
  base: (node?: string | null) => (node ? `/api/nodes/${node}` : '/api'),
});
