// エンコードの設定の空いている所に、一番上の選択肢を入れる（録画詳細の ENCODE）。
// エンコーダーを選び直すとサーバー・プリセットが空に戻り、「〜へ送信」は送り先の選択肢が後から届くので、
// 空のまま保存できない・戻ると全部空、になっていた。空の所だけ埋め、選んである値は変えない。
import { presetValues, type AmzServer, type EncodeInfo, type EncoderAddon } from './encodeInfo';

const AMZ = 'amatsukaze_servers';

/**
 * 実際に編集する設定（effectiveInfo の値）の空いている所を埋める。変えた時だけ新しい値、変えなければ null
 * - Amatsukaze: サーバーが空 → 一番上のサーバー。プリセットの各欄（input_ts・mode・出力先・プロファイルなど）が
 *   空 → そのサーバーの一番上のプリセットの値。プロファイルが一番上のプリセットにも無い時だけ、プロファイルの一番上
 */
export function fillAmzDefaults(eff: EncodeInfo | null, servers: AmzServer[], profiles: { name: string }[] = []): EncodeInfo | null {
  if (!eff || eff.encode_type !== AMZ) return null;
  let e = eff;
  let changed = false;
  if (!e.encode_link && servers[0]) {
    e = { ...e, encode_link: servers[0].url, encode_preset: null };
    changed = true;
  }
  const server = servers.find((s) => s.url === e.encode_link);
  const top = server?.encode_preset?.[0] ? (presetValues(server.encode_preset[0]) as Preset) : null;
  const cur = (e.encode_preset ?? {}) as Preset;
  const next: Preset = { ...cur, outputs: { ...(cur.outputs ?? {}) } };
  for (const [k, v] of Object.entries(top ?? {})) {
    if (k !== 'outputs' && blank(next[k]) && !blank(v)) next[k] = v;
  }
  for (const [k, v] of Object.entries(top?.outputs ?? {})) {
    if (blank(next.outputs![k]) && !blank(v)) next.outputs![k] = v;
  }
  if (blank(next.outputs!.profile) && profiles[0]) next.outputs!.profile = profiles[0].name;
  if (!Object.keys(next.outputs!).length) delete next.outputs;
  if (JSON.stringify(next) !== JSON.stringify(e.encode_preset ?? {})) {
    e = { ...e, encode_preset: next };
    changed = true;
  }
  return changed ? e : null;
}

type Preset = Record<string, unknown> & { outputs?: Record<string, unknown> };
const blank = (v: unknown) => v === undefined || v === null || v === '';

/** アドオンの項目で値の無い物に、既定（無ければ選ぶ形式は一番上）を入れる。変えた時だけ新しい値、変えなければ null */
export function fillAddonDefaults(info: EncodeInfo | null, addon: EncoderAddon | null): EncodeInfo | null {
  if (!info || !addon) return null;
  const params = { ...((info.encode_preset?.params as Record<string, unknown> | undefined) ?? {}) };
  let changed = false;
  for (const p of addon.params ?? []) {
    if (params[p.key] !== undefined && params[p.key] !== '') continue;
    const v = p.default ?? (p.type === 'select' ? p.options?.[0] : undefined) ?? (p.type === 'bool' ? false : undefined);
    if (v === undefined || v === null || v === params[p.key]) continue;
    params[p.key] = v;
    changed = true;
  }
  return changed ? { ...info, encode_preset: { ...(info.encode_preset ?? {}), params } } : null;
}
