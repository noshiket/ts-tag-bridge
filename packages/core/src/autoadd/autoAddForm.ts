// 自動予約（EPG キーワード予約）の編集の値と、保存・試しの検索に送る形
import { initRecSetting, recSettingPayload, type RecSettingForm } from '../recsetting/recSetting';
import { normalizeContentList, searchParams } from '../epg/search';
import type { AddonSearchInfo, AutoAddRule, DateRange, PendingAutoAdd } from './rules';

export interface AutoAddForm extends RecSettingForm {
  disableFlag: boolean; note: string; andKey: string; notKey: string;
  titleOnlyFlag: boolean; aimaiFlag: boolean; regExpFlag: boolean; caseFlag: boolean;
  freeCAFlag: number; contentList: number[]; notContetFlag: boolean; serviceList: string[];
  chkDurationMin: number; chkDurationMax: number; chkRecEnd: boolean; chkRecNoService: boolean; chkRecDay: number;
  dateList: DateRange[]; notDateFlag: boolean;
}

/** 編集の始めの値（既存のルール、無ければ引き継いだ条件） */
export function initAutoAddForm(item: AutoAddRule | null, pa: PendingAutoAdd | null): AutoAddForm {
  const p = item ? null : pa;
  return {
    disableFlag: item?.disableFlag || false,
    note: item?.note || '',
    andKey: item?.andKey || p?.and_key || '',
    notKey: item?.notKey || p?.not_key || '',
    titleOnlyFlag: item?.titleOnlyFlag || p?.title_only_flag || false,
    aimaiFlag: item?.aimaiFlag || p?.aimai_flag || false,
    regExpFlag: item?.regExpFlag ?? p?.reg_exp_flag ?? false,
    caseFlag: item?.caseFlag || false,
    freeCAFlag: item?.freeCAFlag ?? p?.free_ca_flag ?? 0,
    contentList: item?.contentList || p?.content_list?.map((c) => c.content_nibble) || [],
    notContetFlag: item?.notContetFlag ?? p?.not_content_flag ?? false,
    serviceList: item?.serviceList || p?.service_list?.map((s) => `${s.onid}-${s.tsid}-${s.sid}`) || [],
    chkDurationMin: item?.chkDurationMin || p?.chk_duration_min || 0,
    chkDurationMax: item?.chkDurationMax || p?.chk_duration_max || 0,
    chkRecEnd: item?.chkRecEnd || false,
    chkRecNoService: item?.chkRecNoService || false,
    chkRecDay: item?.chkRecDay || 0,
    dateList: item?.dateList || [],
    notDateFlag: item?.notDateFlag || false,
    ...initRecSetting(item?.rec_setting || p?.recSetting) };
}

/** POST / PATCH /api/auto_add の中身。PATCH は省いた所を変えないので、編集の値は全部はっきり送る（オフ・空も） */
export function autoAddBody(f: AutoAddForm): Record<string, unknown> {
  return {
    disable_flag: !!f.disableFlag, note: f.note || '', and_key: f.andKey, not_key: f.notKey || '',
    title_only_flag: !!f.titleOnlyFlag, aimai_flag: !!f.aimaiFlag, reg_exp_flag: !!f.regExpFlag, case_flag: !!f.caseFlag,
    free_ca_flag: f.freeCAFlag || 0,
    content_list: normalizeContentList(f.contentList).map((v) => ({ content_nibble: v })),
    not_content_flag: !!f.notContetFlag,
    service_list: f.serviceList.map((k) => { const [onid, tsid, sid] = k.split('-').map(Number); return { onid, tsid, sid }; }),
    chk_duration_min: f.chkDurationMin || 0, chk_duration_max: f.chkDurationMax || 0,
    chk_rec_end: !!f.chkRecEnd, chk_rec_no_service: !!f.chkRecNoService, chk_rec_day: f.chkRecDay || 0,
    date_list: f.dateList, not_date_flag: !!f.notDateFlag,
    ...recSettingPayload(f) };
}

/** 配信のルールの条件（照合は録画アドオンが EDCB と同じ意味で行う）。保存はまとめた値、試しの検索はまとめる前の値（元と同じ） */
export function addonSearchInfo(f: AutoAddForm, contentList: number[]): AddonSearchInfo {
  return {
    andKey: f.andKey || '', notKey: f.notKey || '', regExpFlag: !!f.regExpFlag, titleOnlyFlag: !!f.titleOnlyFlag, caseFlag: !!f.caseFlag,
    contentList: contentList.map((v) => ({ content_nibble: v })), notContetFlag: !!f.notContetFlag,
    chkDurationMin: f.chkDurationMin || 0, chkDurationMax: f.chkDurationMax || 0, dateList: f.dateList || [], notDateFlag: !!f.notDateFlag };
}

/** 試しの検索（EDCB の局）の問い合わせ。番組検索と同じ送り方（アーカイブ・大小文字は送らない） */
export function previewSearchParams(f: AutoAddForm, days: number): string {
  return searchParams({
    andkey: f.andKey, notkey: f.notKey, regExp: f.regExpFlag, aimai: f.aimaiFlag, titleOnly: f.titleOnlyFlag, archive: false,
    serviceList: f.serviceList, contentList: f.contentList, notContent: f.notContetFlag,
    freeCaFlag: (f.freeCAFlag || 0) as 0 | 1 | 2, durationMin: f.chkDurationMin, durationMax: f.chkDurationMax, days });
}

/** 時間帯を1つ足す（元と同じく日曜 0:00〜土曜 23:59） */
export const NEW_DATE_RANGE: DateRange = { startDayOfWeek: 0, startHour: 0, startMin: 0, endDayOfWeek: 6, endHour: 23, endMin: 59 };
