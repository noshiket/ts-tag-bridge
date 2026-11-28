// 分割画面の▼（無音・場面の切り替わり・アドオンの印）
import { cmAddonItems, type CmMarkDecl, cmPointAt, type CmResult, type MarkItem } from './cmResult';

/** 無音の▼の飛び先: 無音の頭ではなく、その中の切り替え位置（SCPos。絵が変わるのはこちら） */
export type Mark = { start: number; end?: number; scene_sec?: number; scene_frame?: number; start_frame?: number; frame?: number;
  extra?: boolean; removed_sec?: number;
  /** アドオンの印から足した▼（その印の名乗り） */
  by?: CmMarkDecl;
  /** 近くにアドオンの印もある（その印の名乗り。小さな印を添える） */
  also?: CmMarkDecl };
export const muteJump = (m: Mark) => (m.scene_sec != null ? m.scene_sec : m.start);
export const muteJumpFrame = (m: Mark) => (m.scene_frame != null ? m.scene_frame : m.start_frame != null ? m.start_frame : m.frame);

/**
 * その話の▼（無音・近くの切り替わり全部・アドオンが名乗った印）。飛び先で並べる。
 * 解析結果には同じ無音が重複して入っていることがあるので畳む。アドオンの印が既にある▼の近く（near_sec）なら
 * 増やさず、annotate なら印を添える。annotate しない印（「何も無い所にだけ足す」もの）は最後に回す
 */
export function segMarks(cm: CmResult | null, s: { start: number; end: number }, decls: CmMarkDecl[] = []): Mark[] {
  const out: Mark[] = [];
  for (const m of cm?.mutes ?? []) {
    const mt = muteJump(m);
    if (!(mt >= s.start && mt < s.end)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(muteJump(prev) - mt) < 0.001) continue;
    out.push(m);
  }
  // chapter_exe は1つの無音につき一番強い1箇所しか出さないので、近くの切り替わりも全部足す
  for (const x of cm?.scenes_all ?? []) {
    if (!(x.sec >= s.start && x.sec < s.end)) continue;
    if (out.some((m) => Math.abs(muteJump(m) - x.sec) < 0.02)) continue;
    out.push({ start: x.sec, scene_sec: x.sec, scene_frame: x.frame, extra: true });
  }
  const ordered = [...decls.filter((d) => d.jump && d.annotate !== false), ...decls.filter((d) => d.jump && d.annotate === false)];
  for (const d of ordered) {
    const items = cmAddonItems(cm, d.key);
    const pts = d.kind === 'range'
      ? items.flatMap((b) => [{ sec: b.start ?? 0, frame: b.start_frame }, { sec: b.end ?? b.start ?? 0, frame: b.end_frame }])
      : items.map((x) => ({ ...cmPointAt(x), item: x }));
    const near = d.near_sec ?? 0.3;
    for (const x of pts) {
      if (!(x.sec >= s.start && x.sec < s.end)) continue;
      const si = out.findIndex((m) => Math.abs(muteJump(m) - x.sec) < near);
      if (si >= 0) {
        const m = out[si]!;
        if (d.annotate !== false && (m.by?.short ?? m.by?.label) !== (d.short ?? d.label)) out[si] = { ...m, also: d };
        continue;
      }
      const item = 'item' in x ? (x.item as MarkItem) : {};
      out.push({ ...item, start: x.sec, scene_sec: x.sec, scene_frame: x.frame, by: d });
    }
  }
  return out.sort((a, b) => muteJump(a) - muteJump(b));
}

/** 位置に一番近い▼の添字（無ければ -1） */
export function nearestMark(marks: Mark[], t: number): number {
  let bi = -1;
  let bd = Infinity;
  marks.forEach((m, i) => { const d = Math.abs(muteJump(m) - t); if (d < bd) { bd = d; bi = i; } });
  return bi;
}
