import type { Video } from './types';

/** 一覧に出す話の見出し: 「#6 冬樹と桃華の秘密基地きち探訪」。話数も副題も無ければ番組名 */
export function episodeTitle(v: Pick<Video, 'episode_number' | 'episode_name' | 'eit_title'>): string {
  const num = v.episode_number ? `#${v.episode_number}` : '';
  const name = v.episode_name ?? '';
  const label = [num, name].filter(Boolean).join(' ');
  return label || v.eit_title || '';
}

/** カードの上の小さな見出し: 「アルバム / シリーズ」（無い方は出さない） */
export function videoContextLabel(v: { album_name?: string | null; series_name?: string | null }): string {
  return [v.album_name, v.series_name].filter(Boolean).join(' / ');
}

/** 秒 → "1:23:45" / "23:45" */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** ISO 8601 → "2026/11/07 (土) 09:30"（日本時間で表示する） */
export function formatBroadcast(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('year')}/${p('month')}/${p('day')} (${p('weekday')}) ${p('hour')}:${p('minute')}`;
}
