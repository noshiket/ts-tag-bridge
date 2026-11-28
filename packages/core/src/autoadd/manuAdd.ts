// プログラム予約（EDCB の manu_add: 局・時刻・曜日で毎週入れる予約）
import { initRecSetting, recSettingPayload, type RecSettingForm, type RecSettingRaw } from '../recsetting/recSetting';

/** GET /api/manu_add の1件（start_time は0時からの秒） */
export interface ManuAddRaw {
  id: number; title?: string; station_name?: string; onid: number; tsid: number; sid: number;
  start_time: number | null; duration_sec?: number; day_of_week_flag?: number; rec_setting?: RecSettingRaw;
}
const hhmm = (s: number | null) => (s == null ? '' : `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`);
/** 開始・終了（HH:MM）と長さ（分） */
export const manuAddTimes = (m: ManuAddRaw) => ({
  start: hhmm(m.start_time), end: hhmm(m.start_time != null ? m.start_time + (m.duration_sec || 0) : null), durationMin: Math.floor((m.duration_sec || 0) / 60) });

export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
/** 曜日のまとめ選び */
export const DOW_PRESETS: [string, number][] = [['毎日', 0x7f], ['平日', 0x3e], ['週末', 0x41], ['クリア', 0]];
export const hasDow = (flag: number, bit: number) => (flag & (1 << bit)) !== 0;

export interface ManuAddForm extends RecSettingForm {
  title: string;
  /** 'onid-tsid-sid'（1局だけ） */
  service_id: string;
  start_time: string; end_time: string;
  day_of_week_flag: number;
}
/** 新規は毎日 */
export function initManuAddForm(m: ManuAddRaw | null): ManuAddForm {
  const t = m ? manuAddTimes(m) : null;
  return {
    title: m?.title || '',
    service_id: m && m.onid != null ? `${m.onid}-${m.tsid}-${m.sid}` : '',
    start_time: t?.start || '', end_time: t?.end || '',
    day_of_week_flag: m?.day_of_week_flag ?? 0x7f,
    ...initRecSetting(m?.rec_setting) };
}
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
/** 保存できるか（局と開始・終了が要る） */
export const canSaveManuAdd = (f: ManuAddForm) => !!f.service_id.trim() && HHMM.test(f.start_time) && HHMM.test(f.end_time);
export const manuAddBody = (f: ManuAddForm): Record<string, unknown> => ({
  title: f.title || undefined, service_id: f.service_id, start_time: f.start_time, end_time: f.end_time,
  day_of_week_flag: f.day_of_week_flag, ...recSettingPayload(f) });

