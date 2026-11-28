// 録画のエンコードの設定（録画詳細の ENCODE。元の Web 版の detail_rec.jsx と同じ決め方）。
// 種類は3つ: 設定ファイルのエンコーダー（amatsukaze_servers など）、アドオン（addon:<名前>）、
// 他のサーバーへ録画ごと送る（node:<名前>。送り先の設定を encode_preset の中に入れ子で持つ）
import type { ApiClient } from '../http/client';
import { nodePath } from '../http/node';

export interface AmzServer { name?: string; url: string; encode_preset?: (Record<string, unknown> & { name: string })[] }
export interface EncoderAddonParam { key: string; label: string; type: 'number' | 'text' | 'bool' | 'select' | string; default?: unknown; required?: boolean; options?: unknown[] | null }
export interface EncoderAddon { name: string; label: string; description?: string | null; params?: EncoderAddonParam[] }

/** GET /api/encode/options（録画詳細に要る分だけ。他のサーバーにも聞ける） */
export interface EncodeOptions {
  edcb_servers?: { name: string; encode?: { encode_type?: string; name?: string }[] }[];
  amatsukaze_servers?: AmzServer[];
  encoder_addons?: EncoderAddon[];
  remote_nodes?: { name: string }[];
  encode_dir_list?: string[];
  library_peer_name?: string | null;
}

export interface EncodeInfo {
  encode_type: string;
  encode_link: string;
  encode_preset: Record<string, unknown> | null;
  [k: string]: unknown;
}

/** まだ決めていない時の既定: 最初の EDCB サーバーの最初のエンコーダー（Amatsukaze ならサーバーの URL も） */
export function defaultEncodeInfo(o: EncodeOptions): EncodeInfo | null {
  const first = o.edcb_servers?.[0]?.encode?.[0];
  if (!first) return null;
  const type = first.encode_type || '';
  const link = type === 'amatsukaze_servers' ? o.amatsukaze_servers?.find((s) => s.name === first.name)?.url || '' : '';
  return { encode_type: type, encode_link: link, encode_preset: null };
}

/** 選べるエンコーダー（設定のもの・アドオン・送り先のサーバー） */
export function encoderChoices(o: EncodeOptions): { type: string; label: string }[] {
  const conf = [...new Set((o.edcb_servers ?? []).flatMap((s) => (s.encode ?? []).map((e) => e.encode_type)).filter((t): t is string => !!t))];
  return [
    ...conf.map((t) => ({ type: t, label: t })),
    ...(o.encoder_addons ?? []).map((a) => ({ type: `addon:${a.name}`, label: a.label })),
    ...(o.remote_nodes ?? []).map((n) => ({ type: `node:${n.name}`, label: `${n.name}へ送信` })),
  ];
}

/** エンコーダーを選ぶ（送る時は、送り先の Amatsukaze の設定を入れ子で始める） */
export function selectEncoder(info: EncodeInfo | null, type: string): EncodeInfo {
  return type.startsWith('node:')
    ? { ...(info ?? {}), encode_type: type, encode_link: '', encode_preset: { encode_type: 'amatsukaze_servers', encode_link: '', encode_preset: null } }
    : { ...(info ?? {}), encode_type: type, encode_link: '', encode_preset: null };
}

/** 送り先のサーバー（node:<名前> の時） */
export const delegateNodeOf = (info: EncodeInfo | null) => (info?.encode_type?.startsWith('node:') ? info.encode_type.slice(5) : null);

/** 実際に編集する設定（送る時は送り先の分＝入れ子の中） */
export const effectiveInfo = (info: EncodeInfo | null): EncodeInfo | null =>
  delegateNodeOf(info) ? ((info?.encode_preset as EncodeInfo | null) ?? null) : info;

/** 実際に編集する設定を書き換える */
export function updateEffective(info: EncodeInfo | null, fn: (eff: EncodeInfo) => EncodeInfo): EncodeInfo {
  const base: EncodeInfo = info ?? { encode_type: '', encode_link: '', encode_preset: null };
  if (delegateNodeOf(info)) return { ...base, encode_preset: fn({ ...((base.encode_preset as EncodeInfo) ?? {}) }) };
  return fn({ ...base });
}

/** 選んでいるアドオン */
export const selectedAddon = (info: EncodeInfo | null, o: EncodeOptions) =>
  info?.encode_type?.startsWith('addon:') ? (o.encoder_addons ?? []).find((a) => `addon:${a.name}` === info.encode_type) ?? null : null;

/** アドオンの項目の今の値（無ければ既定、真偽は false、他は空） */
export function addonParamValue(info: EncodeInfo | null, p: EncoderAddonParam): unknown {
  const cur = ((info?.encode_preset?.params as Record<string, unknown> | undefined) ?? {})[p.key];
  if (cur !== undefined) return cur;
  if (p.default !== undefined && p.default !== null) return p.default;
  return p.type === 'bool' ? false : '';
}

export const setAddonParam = (info: EncodeInfo | null, key: string, v: unknown): EncodeInfo => {
  const base: EncodeInfo = info ?? { encode_type: '', encode_link: '', encode_preset: null };
  const preset = base.encode_preset ?? {};
  return { ...base, encode_preset: { ...preset, params: { ...((preset.params as Record<string, unknown>) ?? {}), [key]: v } } };
};

/** 保存できるか: アドオンは選べば保存できる。他はプリセット（送る時は送り先のプリセット）が要る */
export function canSaveEncodeInfo(info: EncodeInfo | null, o: EncodeOptions, hasDbRec: boolean): boolean {
  if (!hasDbRec) return false;
  if (selectedAddon(info, o)) return true;
  return delegateNodeOf(info) ? !!effectiveInfo(info)?.encode_preset : !!info?.encode_preset;
}

/** 保存する中身（画面だけで使う _preset_name は送らない） */
export const encodeInfoBody = (info: EncodeInfo | null) =>
  Object.fromEntries(Object.entries(info ?? {}).filter(([k]) => k !== '_preset_name'));

/** Amatsukaze のプリセットを入力へ広げる（名前は除く） */
export const presetValues = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'name'));

export const encodeInfoApi = (c: ApiClient) => ({
  options: (node?: string | null) => c.get<EncodeOptions>(nodePath(node, '/api/encode/options')),
  /** Amatsukaze のプロファイル（出力の設定の名前） */
  amzProfiles: (url: string, node?: string | null) =>
    c.get<{ name: string }[]>(nodePath(node, `/api/amatsukaze/profiles${url ? `?url=${encodeURIComponent(url)}` : ''}`)),
  save: (dbRecId: number, body: Record<string, unknown>, node?: string | null) =>
    c.patch<unknown>(nodePath(node, `/api/encode/recordings/${dbRecId}/encode_info`), body),
});
