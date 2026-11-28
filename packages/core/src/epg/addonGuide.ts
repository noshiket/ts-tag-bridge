// 番組表のアドオン（target='guide'。元の epg.jsx の _toGuideChannel / _toGuideProg / _findReserve）。
// EDCB 以外の編成（配信サービスなど）を地デジ/BS/CS の隣のタブとして並べる。画面はアドオンの名前を知らず、
// アドオンが返した局・番組と、アドオンが名乗る label・records_guide だけで組む
import type { Reserve } from '../reserves/types';
import type { ChannelGroup, EpgEvent, Genre } from './guide';

/** GET /api/addons/<名前>/guide?date= の返り値（その暦日ぶん） */
export interface AddonGuideDay {
  channels?: { id: string; name: string; short?: string; logo_url?: string | null; live_url?: string | null }[];
  programs?: { ch: string; start_time: string; duration_sec: number; title: string; description?: string; extended_info?: string; genre?: string; url?: string | null }[];
}

/** アドオンの局（番組表の1列）。live_url がある局だけ録画できる */
export interface AddonChannel extends ChannelGroup {
  addon: string;
  /** アドオンが付けた局の ID（予約で使う） */
  chId: string;
  logoUrl: string | null;
  liveUrl: string | null;
}

/** アドオンの番組。EDCB の番組ではないので、予約・実況の勢い・ライブ視聴は使わない */
export interface AddonEvent extends EpgEvent {
  addon: { name: string; chId: string; chName: string; url: string | null; liveUrl: string | null; genre: string };
}
export const isAddonEvent = (e: EpgEvent | null | undefined): e is AddonEvent => !!e && 'addon' in e && !!(e as AddonEvent).addon;

/** 番組表のタブの鍵（地デジ/BS/CS と混ざらないよう 'addon:' を前置） */
export const guideBand = (name: string) => `addon:${name}`;
export const guideNameOf = (band: string) => (band.startsWith('addon:') ? band.slice('addon:'.length) : null);

// アドオンのジャンル → 番組表の色（ARIB の大ジャンルの番号に寄せる）
const GENRE_NIBBLE: Record<string, number> = { news: 0, sport: 1, var: 2, drama: 3, music: 4, movie: 6, anime: 7, doc: 8, edu: 10 };
const nibbleOf = (genre: string | undefined) => {
  const n = GENRE_NIBBLE[(genre || 'var') as Genre] ?? 2;
  return n * 256 + 255;
};

const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/**
 * 取る暦日。番組表の1日は朝4時から翌朝4時なので、末尾の0〜4時を埋めるぶん1日多く取る
 * （Grid・List は2日、Week は並べる日数+1。元と同じ）
 */
export const guideDates = (startMs: number, days: number) => Array.from({ length: days + 1 }, (_, i) => ymd(startMs + i * 86_400_000));

/** 何日分かの返り値を、番組表の局と番組へまとめる（同じ局は1つ。形の合わない行は落とす） */
export function buildAddonGuide(addon: string, days: (AddonGuideDay | null | undefined)[]) {
  const channels: AddonChannel[] = [];
  const byId = new Map<string, AddonEvent[]>();
  const seen = new Set<string>();
  let eventId = 1;
  for (const d of days) {
    if (!d) continue;
    const names: Record<string, string> = {};
    for (const c of d.channels ?? []) {
      if (!c?.id || !c.name) continue;
      names[c.id] = c.name;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const idx = channels.length;
      const id = `${guideBand(addon)}/${c.id}`;
      const base = {
        id, name: c.name, short: c.short || (c.name.length > 6 ? c.name.slice(0, 6) : c.name),
        // EDCB の局ではないので、局の番号は持たない（予約・勢い・ロゴの照合に当たらない値）
        onid: -1, tsid: -1, sid: -(idx + 1), rk: 0, hue: (idx * 53 + 20) % 360,
      };
      channels.push({ ...base, subChannels: [base], addon, chId: c.id, logoUrl: c.logo_url || null, liveUrl: c.live_url || null });
    }
    for (const p of d.programs ?? []) {
      const ch = channels.find((c) => c.chId === p?.ch);
      const start = Date.parse(p?.start_time ?? '');
      if (!ch || !p.title || !Number.isFinite(start) || !(p.duration_sec > 0)) continue;
      const list = byId.get(ch.id) ?? [];
      if (list.some((x) => Date.parse(x.start_time) === start)) continue;
      list.push({
        onid: ch.onid, tsid: ch.tsid, sid: ch.sid, event_id: -(eventId++),
        title: p.title, description: p.description || '', extended_info: p.extended_info || '',
        start_time: new Date(start).toISOString(), duration_sec: p.duration_sec,
        content_nibble: nibbleOf(p.genre), free_ca: null, station_name: names[p.ch] || ch.name,
        addon: { name: addon, chId: ch.chId, chName: ch.name, url: /^https?:\/\//.test(p.url || '') ? p.url! : null, liveUrl: ch.liveUrl, genre: p.genre || 'var' },
      });
      byId.set(ch.id, list);
    }
  }
  for (const l of byId.values()) l.sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  return { channels, byId };
}

const localMin = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * アドオンの番組の予約（録画アドオンが入れたもの）。局の ID と開始の分で引く
 * （局名で引くと配信側が局名を変えたとたんに外れるので、ID を先に見る。元と同じ）
 */
export function findAddonReserve(list: Reserve[], e: AddonEvent): Reserve | undefined {
  const k = localMin(Date.parse(e.start_time));
  return list.find((r) => r.source === 'addon' && String(r.start_time ?? '').slice(0, 16) === k
    && ((r as Reserve & { ch?: string | null }).ch ? (r as Reserve & { ch?: string | null }).ch === e.addon.chId : r.station_name === e.addon.chName));
}

/** 録画アドオンへ送る予約の中身（元の reserveViaAddon と同じ項目。extra は予約フォームの値） */
export function addonReservePayload(e: AddonEvent, extra: Record<string, unknown> = {}) {
  const fmt = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const start = Date.parse(e.start_time);
  return {
    ch: e.addon.chId, ch_name: e.addon.chName, title: e.title, description: e.description || '', extended_info: e.extended_info || '',
    genre: e.addon.genre, start_time: fmt(start), end_time: fmt(start + e.duration_sec * 1000), live_url: e.addon.liveUrl, ...extra,
  };
}
