// 自動予約（EDCB の EPG キーワード予約・プログラム予約と、配信の局のルール）。元の Web 版の auto_reserve.jsx と同じ決め方。
// EDCB のルールと配信のルール（録画アドオンが持つ）は形が違うので、画面では同じ形（AutoAddRule）にそろえて並べる
import { type RecSettingRaw } from '../recsetting/recSetting';
import { type SearchQuery } from '../epg/search';
import type { EpgEvent } from '../epg/guide';

/** 時間帯の絞り込み1つ（EDCB の dateList。曜日は 0=日） */
export interface DateRange { startDayOfWeek: number; startHour: number; startMin: number; endDayOfWeek: number; endHour: number; endMin: number }

/** GET /api/auto_add の1件 */
export interface AutoAddRaw {
  id: number; add_count?: number; disable_flag?: boolean; note?: string;
  rec_setting?: RecSettingRaw;
  search_info?: {
    and_key?: string; not_key?: string; reg_exp_flag?: boolean; title_only_flag?: boolean; aimai_flag?: boolean; case_flag?: boolean;
    free_ca_flag?: number; content_list?: ({ content_nibble: number } | number)[]; not_content_flag?: boolean;
    date_list?: DateRange[]; not_date_flag?: boolean; service_list?: ({ onid: number; tsid: number; sid: number } | string)[];
    chk_duration_min?: number; chk_duration_max?: number; chk_rec_end?: boolean; chk_rec_no_service?: boolean; chk_rec_day?: number;
  };
}

/** 配信のルールの条件（EDCB の searchInfo と同じ名前） */
export interface AddonSearchInfo {
  andKey: string; notKey: string; regExpFlag: boolean; titleOnlyFlag: boolean; aimaiFlag?: boolean; caseFlag: boolean;
  contentList: { content_nibble: number }[]; notContetFlag: boolean;
  chkDurationMin: number; chkDurationMax: number; dateList: DateRange[]; notDateFlag: boolean;
}
/** 録画アドオンの auto_rules の1件 */
export interface AddonRuleRaw { search_info?: Partial<AddonSearchInfo> & { contentList?: ({ content_nibble: number } | number)[] }; channels?: string[]; enabled?: boolean; note?: string }

/** 一覧と編集で使う形 */
export interface AutoAddRule {
  id: number;
  /** 配信のルールならそれを持つ録画アドオンの名前（番号は負） */
  addon?: string;
  /** 配信の局（'<番組表アドオン名>/<局ID>'） */
  channels?: string[];
  addCount: number; disableFlag: boolean; note: string;
  andKey: string; notKey: string; regExpFlag: boolean; titleOnlyFlag: boolean; aimaiFlag: boolean; caseFlag: boolean;
  freeCAFlag: number; contentList: number[]; notContetFlag: boolean; dateList: DateRange[]; notDateFlag: boolean;
  /** 'onid-tsid-sid' */
  serviceList: string[];
  chkDurationMin: number; chkDurationMax: number; chkRecEnd: boolean; chkRecNoService: boolean; chkRecDay: number;
  rec_setting: RecSettingRaw;
}

const nibble = (c: { content_nibble: number } | number) => (typeof c === 'object' ? c.content_nibble : c);

export function adaptAutoAdd(r: AutoAddRaw): AutoAddRule {
  const s = r.search_info ?? {};
  return {
    id: r.id, addCount: r.add_count || 0, disableFlag: r.disable_flag || false, note: r.note || '',
    andKey: s.and_key || '', notKey: s.not_key || '', regExpFlag: s.reg_exp_flag || false, titleOnlyFlag: s.title_only_flag || false,
    aimaiFlag: s.aimai_flag || false, caseFlag: s.case_flag || false, freeCAFlag: s.free_ca_flag || 0,
    contentList: (s.content_list ?? []).map(nibble), notContetFlag: s.not_content_flag || false,
    dateList: s.date_list ?? [], notDateFlag: s.not_date_flag || false,
    serviceList: (s.service_list ?? []).map((sv) => (typeof sv === 'object' ? `${sv.onid}-${sv.tsid}-${sv.sid}` : sv)),
    chkDurationMin: s.chk_duration_min || 0, chkDurationMax: s.chk_duration_max || 0,
    chkRecEnd: s.chk_rec_end || false, chkRecNoService: s.chk_rec_no_service || false, chkRecDay: s.chk_rec_day || 0,
    rec_setting: r.rec_setting ?? {} };
}

export function adaptAddonAutoAdd(id: number, v: AddonRuleRaw, addon: string): AutoAddRule {
  const s = v.search_info ?? {};
  return {
    id, addon, channels: v.channels ?? [], addCount: 0, disableFlag: v.enabled === false, note: v.note || '',
    andKey: s.andKey || '', notKey: s.notKey || '', regExpFlag: !!s.regExpFlag, titleOnlyFlag: !!s.titleOnlyFlag,
    aimaiFlag: !!s.aimaiFlag, caseFlag: !!s.caseFlag, freeCAFlag: 0,
    contentList: (s.contentList ?? []).map(nibble), notContetFlag: !!s.notContetFlag,
    dateList: s.dateList ?? [], notDateFlag: !!s.notDateFlag, serviceList: [],
    chkDurationMin: s.chkDurationMin || 0, chkDurationMax: s.chkDurationMax || 0,
    chkRecEnd: false, chkRecNoService: false, chkRecDay: 0, rec_setting: {} };
}

/** 一覧のカードの録画設定（元の RECMODE_MAP / PRIORITY_MAP） */
const RECMODE: Record<number, string> = { 1: '指定SVC', 2: '全SVC', 3: 'SVC+字幕' };
const PRIORITY: Record<number, string> = { 1: '低', 2: '通常', 3: '高', 4: '最高' };
export function autoAddCardSummary(a: AutoAddRule): string {
  if (a.addon) return `配信 ${a.channels?.length ?? 0}局`;
  const rs = a.rec_setting as { recMode?: number; priority?: number };
  const base = `${RECMODE[rs.recMode || 1] ?? ''} · ${PRIORITY[rs.priority || 2] ?? ''}`;
  return a.serviceList.length ? `${base} · ${a.serviceList.length}ch指定` : base;
}

/** 他の画面（番組検索・番組表・番組のシート）から自動予約を作る時に渡す条件 */
export interface PendingAutoAdd {
  and_key?: string; not_key?: string; title_only_flag?: boolean; aimai_flag?: boolean; reg_exp_flag?: boolean; not_content_flag?: boolean;
  service_list?: { onid: number; tsid: number; sid: number }[];
  content_list?: { content_nibble: number }[];
  free_ca_flag?: number; chk_duration_min?: number; chk_duration_max?: number;
  recSetting?: RecSettingRaw;
}

/** 番組検索の条件から（正規表現・NOT ジャンルも引き継ぐ。落とすと意図と違うルールになる） */
export function pendingFromSearch(q: SearchQuery): PendingAutoAdd {
  return {
    and_key: q.andkey, not_key: q.notkey, title_only_flag: q.titleOnly, aimai_flag: q.aimai, reg_exp_flag: q.regExp,
    not_content_flag: q.notContent,
    service_list: q.serviceList.map((s) => { const [onid, tsid, sid] = s.split('-').map(Number); return { onid: onid!, tsid: tsid!, sid: sid! }; }),
    content_list: q.contentList.map((v) => ({ content_nibble: v })),
    free_ca_flag: q.freeCaFlag, chk_duration_min: q.durationMin, chk_duration_max: q.durationMax,
    recSetting: { recMode: 1, priority: 2 } };
}
/** 1つの番組から（その題名・その局） */
export const pendingFromEvent = (e: Pick<EpgEvent, 'title' | 'onid' | 'tsid' | 'sid'>): PendingAutoAdd =>
  ({ and_key: e.title, service_list: [{ onid: e.onid, tsid: e.tsid, sid: e.sid }] });
