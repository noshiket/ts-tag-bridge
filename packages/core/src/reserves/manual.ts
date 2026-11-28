// 手動予約（元の Web 版の settings.jsx の ManualReserveScreen）。日付・時刻・局を決めて EDCB に1件予約を入れる

export interface ManualReserveForm {
  /** 'YYYY-MM-DD' */
  startdate: string;
  /** 'HH:MM:SS' */
  starttime: string; endtime: string;
  /** 'onid-tsid-sid' */
  service: string;
  title: string;
  recMode: number; priority: number; tuijyuuFlag: number; pittariFlag: number; tunerID: number; suspendMode: number;
  useDefMargin: number; startMargin: number; endMargin: number;
  serviceMode: number; partialRecFlag: number; continueRecFlag: number; rebootFlag: number;
  recFolder: string; writePlugIn: string; recNamePlugIn: string; recName: string; batFilePath: string; batFileTag: string;
  /** '' はプリセットを使わない */
  presetID: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 始めの値: 今日の 20:00〜21:00（局は読めたら先頭の局） */
export function initManualReserve(now = new Date()): ManualReserveForm {
  return {
    startdate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, starttime: '20:00:00', endtime: '21:00:00',
    service: '', title: '',
    recMode: 1, priority: 2, tuijyuuFlag: 1, pittariFlag: 0, tunerID: 0, suspendMode: 0,
    useDefMargin: 1, startMargin: 5, endMargin: 0,
    serviceMode: 1, partialRecFlag: 0, continueRecFlag: 0, rebootFlag: 0,
    recFolder: '', writePlugIn: '', recNamePlugIn: '', recName: '', batFilePath: '', batFileTag: '', presetID: '',
  };
}

/** POST /api/reserves の中身（空欄は送らない。題名が無ければ「手動予約」） */
export function manualReserveBody(f: ManualReserveForm): Record<string, unknown> {
  return {
    start_date: f.startdate, start_time: f.starttime, end_time: f.endtime, service_id: f.service, title: f.title || '手動予約',
    rec_mode: f.recMode, priority: f.priority, tuijyuu_flag: f.tuijyuuFlag, tuner_id: f.tunerID, suspend_mode: f.suspendMode,
    use_def_margin: f.useDefMargin,
    ...(f.useDefMargin === 0 ? { start_margin: f.startMargin, end_margin: f.endMargin } : {}),
    pittari_flag: f.pittariFlag, service_mode: f.serviceMode, partial_rec_flag: f.partialRecFlag, continue_rec_flag: f.continueRecFlag,
    reboot_flag: f.rebootFlag,
    ...(f.recFolder ? { rec_folder: f.recFolder } : {}),
    ...(f.writePlugIn ? { write_plug_in: f.writePlugIn } : {}),
    ...(f.recNamePlugIn ? { rec_name_plug_in: f.recNamePlugIn } : {}),
    ...(f.recName ? { rec_name: f.recName } : {}),
    ...(f.batFilePath ? { bat_file_path: f.batFilePath } : {}),
    ...(f.batFileTag ? { bat_file_tag: f.batFileTag } : {}),
    ...(f.presetID !== '' ? { preset_id: Number(f.presetID) } : {}),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 打った値が送れる形か（Web の日付・時刻の入力欄の代わりに打つので確かめる） */
export const canSubmitManualReserve = (f: ManualReserveForm) =>
  !!f.service && DATE.test(f.startdate) && TIME.test(f.starttime.slice(0, 5)) && TIME.test(f.endtime.slice(0, 5));
