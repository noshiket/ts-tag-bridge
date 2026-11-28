import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';
import type { CmAnalysis, SegChapter } from '../split/cm';
import { recordingsQuery, type RecFilters } from './list';
import type { Recording, RecordingDetail, RecordingPage, RecordingProbe } from './types';

export const recordingsApi = (c: ApiClient) => ({
  list: (f: RecFilters, page: number, perPage: number, node?: string | null) =>
    c.get<RecordingPage>(nodePath(node, `/api/recordings/augmented?${recordingsQuery(f, page, perPage)}`)),
  /**
   * 消す（このアプリの記録・TS・サムネ）。keepEdcb: EDCB の録画結果は残す。
   * 手動で登録した録画は別の入口
   */
  remove: (r: Pick<Recording, 'id' | 'is_manual' | 'manual_id'>, keepEdcb: boolean, node?: string | null) =>
    c.delete<unknown>(nodePath(node, r.is_manual
      ? `/api/recordings/manual/${r.manual_id}${keepEdcb ? '?skip_edcb=true' : ''}`
      : `/api/recordings/${r.id}${keepEdcb ? '?skip_edcb=true' : ''}`)),
  /** TS ファイルを手で録画として登録する（サーバーから見えるパス） */
  addManual: (tsPath: string, node?: string | null) => c.post<unknown>(nodePath(node, '/api/recordings/manual'), { ts_path: tsPath }),
  one: (dbRecId: number, node?: string | null) => c.get<RecordingDetail>(nodePath(node, `/api/recordings/augmented/${dbRecId}`)),
  probe: (dbRecId: number, node?: string | null) => c.get<RecordingProbe>(nodePath(node, `/api/encode/recordings/${dbRecId}/probe`)),
  /** 再解析。fresh: しょぼいカレンダーに問い合わせ直してから */
  reparse: (dbRecId: number, fresh: boolean, node?: string | null) =>
    c.post<{ text_parser_result?: Record<string, unknown>; text_parser_context?: unknown }>(
      nodePath(node, `/api/encode/recordings/${dbRecId}/reparse${fresh ? '?fresh=1' : ''}`), {}, { timeoutMs: 60_000 }),
  /** 待機・エラーの録画をエンコードのキューへ（優先度 1〜5、高い順に実行） */
  queue: (dbRecId: number, priority: number, node?: string | null) =>
    c.post<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/queue`), { priority }),
  /** キューにある分（Amatsukaze の項目・作業フォルダごと）を消して入れ直す */
  requeue: (dbRecId: number, priority: number, node?: string | null) =>
    c.post<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/requeue`), { priority }),
  /** EDCB の保護（消されないようにする） */
  setProtect: (id: number, on: boolean, node?: string | null) => c.patch<unknown>(nodePath(node, `/api/recordings/${id}`), { protect_flag: on }),
  // 「…」の操作（録画詳細）
  /** EIT をもう一度読む（番組情報・解析も取り直す） */
  scanEit: (dbRecId: number, node?: string | null) => c.post<Record<string, unknown>>(nodePath(node, `/api/encode/recordings/${dbRecId}/scan_eit`), {}),
  /** TS の冒頭から offsetSec 秒ずらした時点で放送中だった番組の情報を読み直す（null なら 予約の開始マージン + 15 秒） */
  scanEitHead: (dbRecId: number, offsetSec: number | null, node?: string | null) =>
    c.post<{ title?: string; offset_sec?: number }>(nodePath(node, `/api/encode/recordings/${dbRecId}/scan_eit_head`),
      offsetSec == null ? {} : { offset_sec: offsetSec }, { timeoutMs: 600_000 }),
  /** CM 解析をやり直す（数分かかる。結果は分割の画面で見る。走っている時は 409） */
  cmAnalysis: (dbRecId: number, node?: string | null) => c.post<{ started?: boolean }>(nodePath(node, `/api/encode/recordings/${dbRecId}/cm_analysis`)),
  /** 別のサーバーへ録画を送る（エンコードはしない。送っている時は 409） */
  transfer: (dbRecId: number, toNode: string, node?: string | null) =>
    c.post<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/transfer`), { node: toNode }),
  /** 解析を止める（節目で止まるので、すぐには止まらない）・再開する */
  cancelScan: (dbRecId: number, node?: string | null) => c.post<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/cancel_scan`), {}),
  rescan: (dbRecId: number, node?: string | null) => c.post<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/rescan`), {}),
  /** エンコードのキューから取り消す */
  cancelEncode: (dbRecId: number, node?: string | null) =>
    c.post<{ cancelled?: unknown[] }>(nodePath(node, `/api/encode/recordings/${dbRecId}/cancel_encode`), {}),
  /** TS から局のロゴを取り出して保存する */
  extractLogo: (dbRecId: number, node?: string | null) =>
    c.post<{ saved?: unknown[]; skipped?: unknown[] }>(nodePath(node, `/api/encode/recordings/${dbRecId}/extract_logo`), {}),
  /** DB の列の値をそのまま */
  columns: async (dbRecId: number, node?: string | null) =>
    (await c.get<{ columns?: Record<string, unknown> }>(nodePath(node, `/api/encode/recordings/${dbRecId}/columns`))).columns ?? {},
  /** 分割の区切りを書き換える（SKIP の付け外しなど） */
  setSegments: (dbRecId: number, segments: string[], node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/segments`), { segments }),
  /** 録画の t 秒のコマ */
  /**
   * その時刻のコマ。解析の印へ飛んだ時はフレーム番号で引く（秒へ直すとサーバーが番号へ引き直す所で1つ後ろへずれる。
   * 実測 rec 4913 で scenes 148件中79件）
   */
  frameUrl: (dbRecId: number, t: number, node?: string | null, frame?: number | null) =>
    c.url(nodePath(node, `/api/encode/recordings/${dbRecId}/frame?t=${t}${frame != null && Number.isFinite(frame) ? `&frame=${Math.round(frame)}` : ''}`)),
  /** 録画のサムネ（t 秒のコマ） */
  thumbnailUrl: (dbRecId: number, node?: string | null, t = 5) =>
    c.url(nodePath(node, `/api/encode/recordings/${dbRecId}/thumbnail?t=${t}`)),
  /**
   * 厳密なコマ番号（時刻ごと）。表を作っている間は ready=false。
   * 既定の待ち時間では足りない（分割画面を開くと静止画を話数ぶん同時に頼み、その間この要求が並ぶ。元と同じ 30 秒）
   */
  frames: (dbRecId: number, times: number[], node?: string | null) =>
    c.get<{ ready?: boolean; frames?: (number | null)[]; unsupported?: boolean; error?: string }>(
      nodePath(node, `/api/encode/recordings/${dbRecId}/frames?t=${times.map((x) => Number(x).toFixed(3)).join(',')}`), { timeoutMs: 30_000 }),
  /**
   * 分割画面で再生する時の、その位置からの映像。秒未満を捨てない（サーバーはそのまま ffmpeg -ss に渡す。切り捨てると最大1秒手前に飛ぶ）。
   * Web は fMP4 の流し、iOS は HLS（元は Safari だけ HLS）
   */
  videoStreamUrl: (dbRecId: number, t: number, node?: string | null) =>
    c.url(nodePath(node, `/api/encode/recordings/${dbRecId}/video_stream?t=${t.toFixed(3)}`)),
  hlsUrl: (dbRecId: number, t: number, dur = 600, node?: string | null) =>
    c.url(nodePath(node, `/api/encode/recordings/${dbRecId}/hls/manifest.m3u8?t=${t.toFixed(3)}&dur=${Math.ceil(dur)}`)),
  /**
   * CM解析の結果と、走っている仕事。分割画面は開くと静止画を話数ぶん同時に頼むので、既定の待ち時間では打ち切られる（元と同じ 30 秒）。
   * 取得に失敗しただけの時は fetchFailed（未解析の ready:false と分ける。前の結果を消さずに取り直すため）
   */
  cmAnalysisStatus: async (dbRecId: number, node?: string | null): Promise<CmAnalysis & { fetchFailed?: boolean }> => {
    try { return await c.get<CmAnalysis>(nodePath(node, `/api/encode/recordings/${dbRecId}/cm_analysis`), { timeoutMs: 30_000 }); }
    catch { return { ready: false, fetchFailed: true }; }
  },
  /** 解析はやり直さず、SmartCut などのアドオンだけ掛け直す（数十秒〜数分） */
  rerunCmAddons: (dbRecId: number, node?: string | null) =>
    c.post<{ after?: Record<string, number> }>(nodePath(node, `/api/encode/recordings/${dbRecId}/cm_analysis/addons`), {}, { timeoutMs: 600_000 }),
  /** 分割に当てたチャプター（サーバーで導出。エンコード時に書く chapter.txt と同じ）。話の添字を保った並びで送る */
  chapters: (dbRecId: number, segments: (string | null)[], node?: string | null) =>
    c.post<{ chapters?: SegChapter[][] }>(nodePath(node, `/api/encode/recordings/${dbRecId}/chapters`), { segments }),
  /** 録画にアドオンを動かす（ロゴ生成など。仕事の番号を返す） */
  runAddon: (dbRecId: number, name: string, params: Record<string, unknown>, node?: string | null) =>
    c.post<{ job_id: string }>(nodePath(node, `/api/encode/recordings/${dbRecId}/addons/${encodeURIComponent(name)}/run`), params),
});
