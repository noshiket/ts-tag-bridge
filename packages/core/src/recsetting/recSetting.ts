// 録画設定（EDCB の recSetting）の編集（元の Web 版の helpers.jsx の initRecSetting / recSettingPayload と同じ）。
// 予約詳細と自動予約の作成・編集で使う

/** EDCB の recSetting（camelCase のまま） */
export type RecSettingRaw = Record<string, unknown> & {
  recFolderList?: { recFolder?: string; writePlugIn?: string; recNamePlugIn?: string; recNameOp?: string }[];
  batFilePath?: string;
};

/** 編集の値（平たくしたもの）。数の項目に EDCB は true/false を返すこともあり、そのまま持つ */
export interface RecSettingForm {
  recMode: number;
  priority: number;
  tuijyuuFlag: number | boolean;
  pittariFlag: number | boolean;
  tunerID: number;
  suspendMode: number;
  /** 1 = 既定のマージン / 0 = 個別に指定 */
  useDefMargin: number;
  startMargin: number;
  endMargin: number;
  /** 1 = 字幕などのサービスも変換する（EDCB の serviceMode 0 が「する」） */
  serviceMode: number;
  partialRecFlag: number | boolean;
  continueRecFlag: number | boolean;
  rebootFlag: number | boolean;
  recFolder: string;
  writePlugIn: string;
  recNamePlugIn: string;
  recName: string;
  batFilePath: string;
  batFileTag: string;
  presetID: string;
}

const n = <T>(v: unknown, d: T) => (v ?? d) as T;

export function initRecSetting(rs: RecSettingRaw | null | undefined): RecSettingForm {
  const f = rs?.recFolderList?.[0];
  return {
    recMode: n(rs?.recMode, 1), priority: n(rs?.priority, 2), tuijyuuFlag: n(rs?.tuijyuuFlag, 1), pittariFlag: n(rs?.pittariFlag, 0),
    tunerID: n(rs?.tunerID, 0), suspendMode: n(rs?.suspendMode, 0),
    useDefMargin: rs?.startMargin != null ? 0 : 1, startMargin: n(rs?.startMargin, 5), endMargin: n(rs?.endMargin, 0),
    serviceMode: rs?.serviceMode === 0 ? 1 : 0,
    partialRecFlag: n(rs?.partialRecFlag, 0), continueRecFlag: n(rs?.continueRecFlag, 0), rebootFlag: n(rs?.rebootFlag, 0),
    recFolder: f?.recFolder ?? '', writePlugIn: f?.writePlugIn ?? '',
    recNamePlugIn: f?.recNamePlugIn?.split('?')[0] ?? '',
    // ファイル名オプションは EDCB のビルドで recNameOp か recNamePlugIn の '?引数' のどちらかで来る
    recName: f?.recNameOp ?? f?.recNamePlugIn?.split('?')[1] ?? '',
    batFilePath: rs?.batFilePath?.split('*')[0] ?? '', batFileTag: rs?.batFilePath?.split('*')[1] ?? '',
    presetID: '',
  };
}

/** 保存する中身（PATCH /api/reserves/<id> などの snake_case）。空の文字の項目は送らない */
export function recSettingPayload(v: RecSettingForm): Record<string, unknown> {
  return {
    rec_mode: v.recMode, priority: v.priority, tuijyuu_flag: v.tuijyuuFlag, pittari_flag: v.pittariFlag,
    tuner_id: v.tunerID, suspend_mode: v.suspendMode, use_def_margin: v.useDefMargin,
    ...(v.useDefMargin === 0 ? { start_margin: v.startMargin, end_margin: v.endMargin } : {}),
    service_mode: v.serviceMode, partial_rec_flag: v.partialRecFlag, continue_rec_flag: v.continueRecFlag, reboot_flag: v.rebootFlag,
    ...(v.recFolder ? { rec_folder: v.recFolder } : {}),
    ...(v.writePlugIn ? { write_plug_in: v.writePlugIn } : {}),
    ...(v.recNamePlugIn ? { rec_name_plug_in: v.recNamePlugIn } : {}),
    ...(v.recName ? { rec_name: v.recName } : {}),
    ...(v.batFilePath ? { bat_file_path: v.batFilePath } : {}),
    ...(v.batFileTag ? { bat_file_tag: v.batFileTag } : {}),
    // preset_id は送らない（EDCB は無視する。選んだプリセットは各項目へ広げた値が正）
  };
}

/** GET /api/rec_setting_options */
export interface RecSettingOptions {
  presets?: { value?: string | number; label: string; rec_setting?: RecSettingRaw }[];
  writePlugIn?: { value: string; label: string }[];
  recNamePlugIn?: { value: string; label: string }[];
  batFilePath?: { value: string; label: string }[];
  /** EDCB の既定（空欄の時に使われる値。手動予約で見せる） */
  defaultRecFolder?: string;
  defaultWritePlugIn?: string;
  defaultRecNamePlugIn?: string;
  defaultStartMargin?: number | null;
  defaultEndMargin?: number | null;
}

/**
 * プリセットを選ぶ: その値を全項目へ広げる（EDCB と同じ）。'' は解除で、original（今保存されている値）に戻す。
 * 録画設定以外の項目を持つ値（自動予約の入力など）でも消さないよう、今の値の上に重ねる
 */
export function applyRecPreset<T extends RecSettingForm>(v: T, presetId: string, opts: RecSettingOptions | undefined, original?: RecSettingForm): T {
  if (presetId === '') return original ? { ...v, ...original, presetID: '' } : { ...v, presetID: '' };
  const p = (opts?.presets ?? []).find((x) => String(x.value) === presetId);
  return p?.rec_setting ? { ...v, ...initRecSetting(p.rec_setting), presetID: presetId } : { ...v, presetID: presetId };
}

/** 詳細に並べる今の値のまとめ */
export function recSettingSummary(v: RecSettingForm): string[] {
  return [
    `モード: ${v.recMode === 2 ? '全サービス' : '指定サービス'}`,
    `優先度: ${v.priority}`,
    `追従: ${v.tuijyuuFlag ? 'する' : 'しない'}`,
    `マージン: ${v.useDefMargin ? 'デフォルト' : `前${v.startMargin}s/後${v.endMargin}s`}`,
    ...(v.recFolder ? [`フォルダ: ${v.recFolder}`] : []),
    ...(v.batFilePath ? ['BATあり'] : []),
  ];
}
