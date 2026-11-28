// 再生するもの: ライブラリの動画（vdb）か録画（video。サーバーの名前のまま）。
// どちらも /api/streams/<kind>/<id>/ の下に同じ形の metadata・playlist・comments などがある（元の stream.jsx の streamBase）

export type StreamTarget = { kind: 'vdb' | 'video'; id: number };
/** 数だけならライブラリの動画 */
export type StreamRef = StreamTarget | number;

export const toTarget = (r: StreamRef): StreamTarget => (typeof r === 'number' ? { kind: 'vdb', id: r } : r);
export const streamBase = (r: StreamRef) => { const t = toTarget(r); return `/api/streams/${t.kind}/${t.id}`; };
/** 取得した結果の置き場所の名前に使う（ライブラリの動画は今までどおり数） */
export const targetKey = (r: StreamRef): number | string => { const t = toTarget(r); return t.kind === 'vdb' ? t.id : `rec:${t.id}`; };

/** 視聴履歴の種類と番号（元の WatchStore の type / id。他のサーバーの録画は「ノード:番号」） */
export function watchIdentity(r: StreamRef, node?: string | null): { type: 'video' | 'recording'; id: string } {
  const t = toTarget(r);
  return t.kind === 'vdb' ? { type: 'video', id: String(t.id) } : { type: 'recording', id: node ? `${node}:${t.id}` : String(t.id) };
}
