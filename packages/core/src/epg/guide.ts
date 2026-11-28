// 番組表（元の Web 版の epg.jsx と同じ決め方）: 朝4時で区切る1日、局のまとめ方（同じ局のサブチャンネルを1列に）、
// 番組のジャンル・印、予約との突き合わせ
import { reserveStatus } from '../reserves/list';
import type { Reserve } from '../reserves/types';

/** GET /api/services の1件 */
export interface Service { onid: number; tsid: number; sid: number; service_name: string; remote_control_key_id?: number }

/** GET /api/epg?service=&no_ext=1 の1件（番組の詳細は落としてある） */
export interface EpgEvent {
  onid: number; tsid: number; sid: number; event_id: number;
  title: string; description: string; extended_info?: string;
  start_time: string; duration_sec: number;
  content_nibble: number | null; free_ca: boolean | null;
  video_info?: string; audio_info?: string; station_name?: string;
}

export type Band = 'terr' | 'bs' | 'cs';
/** 地デジ / BS / CS（ネットワークの番号で） */
export const bandOfOnid = (onid: number): Band => (onid === 4 ? 'bs' : onid === 6 || onid === 7 ? 'cs' : 'terr');

const DAY = 86_400_000;
/** 今日の朝4時（4時より前なら前の日の4時）。番組表の1日はここから24時間 */
export function todayAt4(now = Date.now()): number {
  const d = new Date(now);
  if (d.getHours() < 4) d.setDate(d.getDate() - 1);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
}
const pad = (n: number) => String(n).padStart(2, '0');
export const windowLabel = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]}) ${pad(d.getHours())}:00`;
};
/** 選べる8日（今日から） */
export const weekOptions = (now = Date.now()) =>
  Array.from({ length: 8 }, (_, i) => { const ms = todayAt4(now) + i * DAY; return { ms, label: windowLabel(ms) }; });

/** 編集距離（2以上は2で打ち切る。局名の1文字違いを見るため） */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]!;
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]!;
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i]!, dp[i - 1]!);
      prev = tmp;
    }
  }
  return dp[a.length]!;
}

export interface Channel { id: string; name: string; short: string; onid: number; tsid: number; sid: number; rk: number; hue: number }
export interface ChannelGroup extends Channel { subChannels: Channel[] }

export const channelOf = (s: Service, idx: number): Channel => ({
  id: `${s.onid}-${s.tsid}-${s.sid}`, name: s.service_name, short: s.service_name.slice(0, 6),
  onid: s.onid, tsid: s.tsid, sid: s.sid, rk: s.remote_control_key_id || 0, hue: (idx * 53 + 20) % 360,
});

/**
 * 同じ局のサブチャンネル（同じ TS・近い SID・名前が1文字違い）を1列にまとめる。リモコンの番号順、無ければ onid・sid 順。
 * SID が飛んでいてもまとめる（サーバーは同じ名前の SID を間引くので、みどりテレ1→みどりテレ2 の差が 1 にならない）
 */
export function groupChannels(channels: Channel[]): ChannelGroup[] {
  const sorted = [...channels].sort((a, b) =>
    a.rk && b.rk ? a.rk - b.rk || a.sid - b.sid : a.rk ? -1 : b.rk ? 1 : a.onid - b.onid || a.sid - b.sid);
  const groups: Channel[][] = [];
  for (const ch of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.onid === ch.onid && prev.tsid === ch.tsid && ch.sid > prev.sid && ch.sid - prev.sid <= 4 && editDistance(prev.name, ch.name) <= 1) last!.push(ch);
    else groups.push([ch]);
  }
  return groups.map((subs) => {
    const p = subs[0]!;
    const name = subs.length > 1 ? p.name.replace(/[０-９]/g, '').replace(/[\s・]+$/, '').trim() : p.name;
    return { ...p, name, short: name.slice(0, 6), subChannels: subs };
  });
}

export type Genre = 'news' | 'sport' | 'var' | 'drama' | 'music' | 'movie' | 'anime' | 'doc' | 'edu' | 'kids';
const NIBBLE: Record<number, Genre> = { 0: 'news', 1: 'sport', 2: 'var', 3: 'drama', 4: 'music', 5: 'var', 6: 'movie', 7: 'anime', 8: 'doc', 9: 'drama', 10: 'edu', 11: 'edu' };
export const genreOf = (nibble: number | null | undefined): Genre => (nibble != null ? NIBBLE[Math.floor(nibble / 256)] ?? 'var' : 'var');
export const GENRE_LABEL: Record<Genre, string> = {
  news: 'ニュース', doc: 'ドキュメンタリー', drama: 'ドラマ', var: 'バラエティ', music: '音楽', sport: 'スポーツ', movie: '映画', anime: 'アニメ', kids: 'キッズ', edu: '教育',
};

/** 番組の印（字・再・解・デ・二・新）。番組の構成の記述が無いこともあるので、題名・説明・音声から推して決める */
export function programFlags(p: Pick<EpgEvent, 'title' | 'description' | 'extended_info' | 'audio_info'>): ('字' | '再' | '解' | 'デ' | '二' | '新')[] {
  const t = `${p.title || ''} ${p.description || ''} ${p.extended_info || ''}`;
  const a = p.audio_info || '';
  const out: ('字' | '再' | '解' | 'デ' | '二' | '新')[] = [];
  if (/(\[字\]|字幕)/.test(t) || /字幕/.test(a)) out.push('字');
  if (/(\[再\]|再放送|^再 )/.test(t)) out.push('再');
  if (/(\[解\]|音声解説|解説放送)/.test(t) || /解説/.test(a)) out.push('解');
  if (/(\[デ\]|データ放送)/.test(t)) out.push('デ');
  if (/(\[二\]|二か国語|二ヶ国語)/.test(t) || /二か国語|二ヶ国語/.test(a)) out.push('二');
  if (/(\[新\]|新番組)/.test(t)) out.push('新');
  return out;
}

export const eventKey = (e: Pick<EpgEvent, 'onid' | 'tsid' | 'sid' | 'event_id'>) => `${e.onid}-${e.tsid}-${e.sid}-${e.event_id}`;
export const endMs = (e: Pick<EpgEvent, 'start_time' | 'duration_sec'>) => Date.parse(e.start_time) + e.duration_sec * 1000;
/** その1日（朝4時から24時間）にかかる番組 */
export const inWindow = (e: EpgEvent, start: number) => endMs(e) > start && Date.parse(e.start_time) < start + DAY;

/**
 * 予約の状態（rec = 録画 / skip = スキップ）。番組そのもので引くのが本筋で、無ければ同じ題名の予約に倣う
 * （同じ作品の別の回の予約でも分かるように。同じ題名は録画を優先）
 */
export function reserveMaps(list: Reserve[], now = Date.now()) {
  const byEvent = new Map<string, 'rec' | 'skip'>();
  const byTitle = new Map<string, 'rec' | 'skip'>();
  // 番組表のアドオンの予約（録画アドオンが入れたもの）。局の ID（無ければ局名）と開始の分で引く
  const byAddon = new Map<string, 'rec' | 'skip'>();
  for (const r of list) {
    if (r.source === 'addon') {
      const ch = (r as Reserve & { ch?: string | null }).ch || r.station_name;
      if (r.start_time) byAddon.set(`${ch}\u0000${String(r.start_time).slice(0, 16)}`, 'rec');
      continue;
    }
    const st = reserveStatus(r, now) === 'skipped' ? 'skip' : 'rec';
    byEvent.set(eventKey(r), st);
    if (st === 'rec') byTitle.set(r.title, 'rec');
    else if (!byTitle.has(r.title)) byTitle.set(r.title, 'skip');
  }
  return { byEvent, byTitle, byAddon };
}
const localMin = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const programStatus = (m: ReturnType<typeof reserveMaps>, e: EpgEvent) => {
  // 番組表のアドオンの番組は、その番組の予約だけを見る（同じ題名に倣わせると別の回まで予約済みに見える。元と同じ）
  const a = (e as EpgEvent & { addon?: { chId: string; chName: string } }).addon;
  if (a) { const t = localMin(Date.parse(e.start_time)); return m.byAddon.get(`${a.chId}\u0000${t}`) ?? m.byAddon.get(`${a.chName}\u0000${t}`); }
  return m.byEvent.get(eventKey(e)) ?? m.byTitle.get(e.title);
};
/** 番組そのものの予約 */
export const findReserve = (list: Reserve[], e: EpgEvent) =>
  list.find((r) => r.onid === e.onid && r.tsid === e.tsid && r.sid === e.sid && r.event_id === e.event_id);

/**
 * サブチャンネルを持つ列: 他のサブチャンネルに同じ時間の番組が無いか、同じ番組なら1本にまとめて全幅で出す
 * （まとめた時は最初のサブチャンネルの分だけ描く）
 */
export function isUnified(subProgs: EpgEvent[][], e: EpgEvent, subIdx: number): boolean {
  if (subProgs.length === 1) return true;
  const s = Date.parse(e.start_time);
  const en = endMs(e);
  return subProgs.every((list, i) => {
    if (i === subIdx) return true;
    const o = list.find((p) => Date.parse(p.start_time) < en && endMs(p) > s);
    return !o || (o.title === e.title && Date.parse(o.start_time) === s);
  });
}
