// ビデオカードに出す印の判定（元の Web 版の encode.jsx VideoRow / helpers.jsx と同じ規則）
import type { Video } from './types';

/** drop / scramble の数。errors があればそこから数え、無い古いデータは集計値（サーバーと同じ規則） */
export function dropScrambleCounts(dropError: unknown): { drop: number; scramble: number } | null {
  let d = dropError;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; }
  }
  if (!d || typeof d !== 'object') return null;
  const o = d as { errors?: { error_type?: string }[]; drop_count?: number; scramble_count?: number };
  const errors = Array.isArray(o.errors) ? o.errors : null;
  const drop = errors && errors.length ? errors.filter((e) => e?.error_type === 'PACKET_LOSS').length : o.drop_count || 0;
  return { drop, scramble: o.scramble_count || 0 };
}

/** 放送異常の告知があるか（'none(...)' は無し） */
export const hasTelop = (announce: string | null | undefined) => !!announce && !String(announce).startsWith('none');

/** 副音声（二カ国語・解説など）。番組情報の音声欄か [二] の印で見る（絞り込み用） */
export const hasSecondaryAudioByEit = (v: Pick<Video, 'eit_audio_info' | 'setting'>) =>
  ['デュアル', '1/0+1/0', '二重'].some((m) => (v.eit_audio_info || '').includes(m)) || (v.setting || '').includes('[二]');

/** 字幕（放送由来か、取り込んだもの） */
export const hasAnyCaption = (v: Pick<Video, 'has_caption' | 'has_added_caption'>) => v.has_caption === 1 || v.has_added_caption === 1;

/** コメントの勢い（件数/分）と色の段階。取り込んだ実況の方が多ければそちらで見る */
export function commentDensity(v: Pick<Video, 'comment_count' | 'max_comment_count' | 'duration_sec'>) {
  const count = Math.max(v.comment_count || 0, v.max_comment_count || 0);
  const min = v.duration_sec ? v.duration_sec / 60 : 0;
  const perMin = count && min > 0 ? Math.round(count / min) : null;
  const level = perMin == null ? 0 : perMin >= 110 ? 5 : perMin >= 80 ? 4 : perMin >= 50 ? 3 : perMin >= 20 ? 2 : 1;
  return { count, perMin, level };
}

/** H.264/H.265/MPEG-2 以外（サーバーの画質切り替えが効かず、そのまま再生する）。表示名を返す */
export function oddCodecLabel(codec: string | null | undefined): string | null {
  const c = (codec || '').toLowerCase();
  if (!c || ['h264', 'hevc', 'mpeg2video'].includes(c)) return null;
  return ({ av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg4: 'MPEG-4' } as Record<string, string>)[c] ?? c.toUpperCase();
}


/** 秒 → "23分" / "1時間2分"（一覧のカードの書き方） */
export function formatDurationJa(sec: number | null | undefined): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

/** バイト → "1.2 GB" / "309 MB" */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
}

/** "11/7 09:30"（端末の時刻） */
/** "2026/4/12"（日付だけ。年まで） */
export function dateWithYear(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** "2026/4/12 17:00"（年まで。何年の放送か分かるように） */
export function dateTimeWithYear(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
