// iOS の JS（Hermes）には structuredClone が無い。字幕の解析(aribb24.js)が使うので、無い時だけ足す。
// 解析の状態に出てくる形（ただのオブジェクト・配列・Map・バイト列）だけを深く写す
export function cloneDeep(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof ArrayBuffer) return v.slice(0);
  if (ArrayBuffer.isView(v)) return new (v.constructor as new (b: ArrayBufferLike) => ArrayBufferView)((v as Uint8Array).slice().buffer);
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [cloneDeep(k), cloneDeep(x)]));
  if (Array.isArray(v)) return v.map(cloneDeep);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = cloneDeep(x);
  return out;
}

const g = globalThis as { structuredClone?: (v: unknown) => unknown };
if (typeof g.structuredClone !== 'function') g.structuredClone = cloneDeep;

