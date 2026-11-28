// 設定の「AMZ」（元の SettingsAmatsukaze）。Amatsukaze の状態・ディスク・プロファイル・キュー
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';

/** エンコーダーの種類 → そのオプションの項目名 */
export const AMZ_ENCODER_OPT_KEY: Record<string, string> = {
  x264: 'x264Option', x265: 'x265Option', QSVEnc: 'qsvEncOption', NVEnc: 'nvEncOption', VCEEnc: 'vceEncOption', SVTAV1: 'svtaV1Option',
};
export const AMZ_ENCODERS = ['x264', 'x265', 'QSVEnc', 'NVEnc', 'VCEEnc', 'SVTAV1'];
export const AMZ_OUTPUT_FORMATS = ['MP4', 'MKV', 'M2TS', 'TS', 'TSREPLACE'];
export const AMZ_FILTER_OPTIONS = ['None', 'Setting', 'Custom'];
export const AMZ_DECODERS = ['Default', 'QSV', 'DXVA', 'CUVID', 'D3D11'];
export const AMZ_AUDIO_ENCODERS = ['NeroAac', 'Qaac', 'Fdkaac', 'OpusEnc'];
export const AMZ_AUDIO_OPT_KEY: Record<string, string> = { NeroAac: 'neroAacOption', Qaac: 'qaacOption', Fdkaac: 'fdkaacOption', OpusEnc: 'opusEncOption' };
export const AMZ_DEINTERLACE_ALGOS = ['KFM', 'D3DVP', 'QTGMC', 'Yadif', 'AutoVfr'];
export const AMZ_DEBLOCK_STRENGTHS = ['Very Strong', 'Strong', 'Medium', 'Weak', 'Very Weak'];

export interface AmzFilterSetting {
  enableCUDA: boolean; enableDeinterlace: boolean; deinterlaceAlgorithm: string; kfmFps: string; kfmEnableNr: boolean; kfmEnableUcf: boolean;
  enableDeblock: boolean; deblockStrength: string; deblockQuality: number; deblockSharpen: boolean;
  enableResize: boolean; resizeWidth: number; resizeHeight: number; enableTemporalNR: boolean; enableDeband: boolean; enableEdgeLevel: boolean;
  [k: string]: unknown;
}
/** Amatsukaze のプロファイル（知らない項目もそのまま持って送り返す） */
export interface AmzProfile {
  name: string; lastUpdate?: string; encoderType?: string; outputFormat?: string; encoderParallel?: number; numEncodeBufferFrames?: number;
  filterOption?: string; filterSetting?: Partial<AmzFilterSetting>; bitrate?: { a: number; b: number; h264: number; [k: string]: unknown };
  [k: string]: unknown;
}
export type AmzProfileForm = AmzProfile & { filterSetting: AmzFilterSetting; bitrate: { a: number; b: number; h264: number } };

/** 新しいプロファイルの始めの値（元の AMZ_FORM_DEFAULTS） */
export const AMZ_FORM_DEFAULTS: AmzProfileForm = {
  name: '',
  encoderType: 'QSVEnc',
  x264Option: '', x265Option: '', qsvEncOption: '', nvEncOption: '', vceEncOption: '', svtaV1Option: '',
  encoderParallel: 1, muxerAddEncoderCmd: false,
  forceSAR: false, forceSARWidth: 0, forceSARHeight: 0,
  mpeg2Decoder: 'Default', h264Deocder: 'Default', hevcDecoder: 'Default',
  outputFormat: 'MKV', outputMask: 2,
  useMKVWhenSubExists: false, tsreplaceRemoveTypeD: false, splitSub: false,
  filterOption: 'None', filterPath: '', postFilterPath: '',
  filterSetting: {
    enableCUDA: false, enableDeinterlace: false, deinterlaceAlgorithm: 'KFM', kfmFps: 'VFR', kfmEnableNr: false, kfmEnableUcf: false,
    enableDeblock: false, deblockStrength: 'Medium', deblockQuality: 3, deblockSharpen: false,
    enableResize: false, resizeWidth: 1280, resizeHeight: 720, enableTemporalNR: false, enableDeband: false, enableEdgeLevel: false,
  },
  autoBuffer: false,
  bitrate: { a: 0.4, b: 400, h264: 1.6 },
  bitrateCM: 0.5, cmQualityOffset: 0, twoPass: false,
  enableAudioEncode: false, audioEncoderType: 'NeroAac',
  neroAacOption: '', qaacOption: '', fdkaacOption: '', opusEncOption: '',
  enableAudioBitrate: false, audioBitrateInKbps: 128,
  disableSubs: false, enableWebVTT: false, enableNicoJK: false,
  disableChapter: false, outputChapter: true,
  ignoreNoLogo: false, noDelogo: false, looseLogoDetection: false, ignoreNoDrcsMap: true,
  disableMoveInputFile: false, noRemoveTmp: false, disableLogFile: false, saveProfileText: false,
  ignoreEncodeAffinity: false, disableHashCheck: false,
  numEncodeBufferFrames: 16,
  enablePmtCut: false, pmtCutHeadRate: 0, pmtCutTailRate: 0,
};

/** 編集の始めの値（既定の上に今の値。入れ子も混ぜる） */
export function initAmzProfileForm(initial?: AmzProfile | null): AmzProfileForm {
  const d = AMZ_FORM_DEFAULTS;
  if (!initial) return { ...d, bitrate: { ...d.bitrate }, filterSetting: { ...d.filterSetting } };
  return { ...d, ...initial, bitrate: { ...d.bitrate, ...(initial.bitrate ?? {}) }, filterSetting: { ...d.filterSetting, ...(initial.filterSetting ?? {}) } };
}

/** エンコーダーのオプション（項目名と値） */
export function amzEncoderOption(p: AmzProfile): { key: string; value: string } | null {
  const key = AMZ_ENCODER_OPT_KEY[p.encoderType ?? ''];
  const value = key ? String(p[key] ?? '') : '';
  return key && value ? { key, value } : null;
}

/** フィルタのまとめ（'Setting' なら使っているものを並べる） */
export function amzFilterSummary(p: AmzProfile): string {
  const base = p.filterOption && p.filterOption !== 'None' ? p.filterOption : 'None';
  const fs = p.filterSetting;
  if (!fs || p.filterOption !== 'Setting') return base;
  const on = [fs.enableDeinterlace && 'deint', fs.enableDeblock && 'deblk', fs.enableResize && 'resize', fs.enableTemporalNR && 'NR', fs.enableDeband && 'deband', fs.enableEdgeLevel && 'edge'].filter(Boolean);
  return on.length ? `${base} (${on.join('+')})` : base;
}

export interface AmzDisk { path?: string; capacityBytes: number; freeBytes: number; usedBytes: number; usedRatio?: number }
/** 同じボリュームは1つだけ（容量が同じものは最初の1つ） */
export function uniqueAmzDisks(disks: AmzDisk[]): AmzDisk[] {
  const seen = new Set<number>();
  return disks.filter((d) => (seen.has(d.capacityBytes) ? false : (seen.add(d.capacityBytes), true)));
}
export const amzDiskUsed = (d: AmzDisk) => d.usedRatio ?? (d.capacityBytes > 0 ? d.usedBytes / d.capacityBytes : 0);

export interface AmzQueueItem { id: number; state?: string; stateLabel?: string; fileName?: string; srcPath?: string; serviceName?: string; profileName?: string; stateDetailText?: string }
export interface AmzSystem { state?: { pause?: boolean } }

/** Amatsukaze のロゴ解析の途中経過 */
export interface AmzLogoAnalyze { numValid?: number; numRead?: number; pass?: number; [k: string]: unknown }

export const amatsukazeApi = (c: ApiClient) => ({
  logoAnalyzeStatus: (jobId: string, node?: string | null) => c.get<AmzLogoAnalyze>(nodePath(node, `/api/amatsukaze/logo/analyze/${jobId}`)),
  /** 解析のたびに中身が変わるので時刻を付けて取り直させる */
  logoAnalyzeImageUrl: (jobId: string, node?: string | null) => c.url(nodePath(node, `/api/amatsukaze/logo/analyze/${jobId}/image?t=${Date.now()}`)),
  /** できたロゴを登録する / 捨てる */
  logoAnalyzeApply: (jobId: string, node?: string | null) => c.post<unknown>(nodePath(node, `/api/amatsukaze/logo/analyze/${jobId}/apply`), {}),
  logoAnalyzeDiscard: (jobId: string, node?: string | null) => c.post<unknown>(nodePath(node, `/api/amatsukaze/logo/analyze/${jobId}/discard`), {}),
  system: (node?: string | null) => c.get<AmzSystem>(nodePath(node, '/api/amatsukaze/system')),
  disks: (node?: string | null) => c.get<AmzDisk[] | unknown>(nodePath(node, '/api/amatsukaze/info/disks')),
  profiles: (node?: string | null) => c.get<(AmzProfile | string)[] | unknown>(nodePath(node, '/api/amatsukaze/profiles')),
  /** その Amatsukaze（url）のプロファイルの名前。設定のエンコードの指定で選ぶ用 */
  profileNames: async (url: string, node?: string | null): Promise<string[]> => {
    const d = await c.get<unknown>(nodePath(node, `/api/amatsukaze/profiles?url=${encodeURIComponent(url)}`));
    return Array.isArray(d) ? d.map((x) => (typeof x === 'string' ? x : String((x as { name?: unknown })?.name ?? ''))).filter(Boolean) : [];
  },
  addProfile: (p: AmzProfile, node?: string | null) => c.post<unknown>(nodePath(node, '/api/amatsukaze/profiles'), p),
  updateProfile: (name: string, p: AmzProfile, node?: string | null) => c.put<unknown>(nodePath(node, `/api/amatsukaze/profiles/${encodeURIComponent(name)}`), p),
  deleteProfile: (name: string, node?: string | null) => c.delete<unknown>(nodePath(node, `/api/amatsukaze/profiles/${encodeURIComponent(name)}`)),
  queue: (node?: string | null) => c.get<{ items?: AmzQueueItem[] }>(nodePath(node, '/api/amatsukaze/queue')),
  /** 'RemoveItem'（キューから消す。作業フォルダも消す）/ 'Cancel'（実行中を止める） */
  changeQueue: (itemId: number, changeType: 'RemoveItem' | 'Cancel', node?: string | null) =>
    c.post<{ removed_amt_dir?: string }>(nodePath(node, '/api/amatsukaze/queue/change'), { itemId, changeType }),
  pause: (pause: boolean, node?: string | null) => c.post<unknown>(nodePath(node, '/api/amatsukaze/queue/pause'), { pause, isQueue: true, index: 0 }),
});
