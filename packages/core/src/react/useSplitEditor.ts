// 分割の編集の状態と操作（元の split_editor.jsx の useSplitEditor）。分割タブと分割画面で同じものを使う。
// 再生位置・タイムラインの描き方など画面ごとのものは呼ぶ側が持つ
import { useEffect, useMemo, useState } from 'react';

import { addMuteRange, intervalCuts, renameKeepAt, setChapNameAt, resizedCuts, splitKeepAtTime, updateKeepEdge } from '../split/editOps';
import { autoCuts, buildSegmentsIndexed, segmentsFrom, type KeepRange, type SplitSource, type TimeRange } from '../split/source';

export type SegState = 'auto' | 'adjusted' | 'fixed';

export function useSplitEditor(src: SplitSource | null, fps = 30000 / 1001) {
  const total = src?.duration || 0;
  const episodeCount = src?.episodeCount || 1;
  const FRAME = 1 / fps;

  const [manualCuts, setManualCuts] = useState<number[]>([]);   // 手で直した切れ目（空なら interval からの自動）
  const [manualGaps, setManualGaps] = useState<number[]>([]);
  const [linked, setLinked] = useState(true);
  const [intervalMin, setIntervalMin] = useState(src?.broadcastMin || 30);
  const [pinnedSegs, setPinnedSegs] = useState<Set<number>>(new Set());
  const [remainderAt, setRemainderAt] = useState<'start' | 'end'>('end');
  const [keepList, setKeepList] = useState<Record<number, KeepRange[]>>({});
  const [pendingKeep, setPendingKeep] = useState<{ segIdx: number; in: number | null; out: number | null } | null>(null);
  const [editingKeep, setEditingKeep] = useState<unknown>(null);
  const [skipList, setSkipList] = useState<Record<number, boolean>>({});
  // 録画全体の頭と終わりのトリム（最初の話の IN / 最後の話の OUT）
  const [headTrim, setHeadTrimState] = useState(0);
  const [trimEnd, setTrimEndState] = useState(total || 0);
  const [chapNames, setChapNames] = useState<Record<number, Record<string, string>>>(src?.initialChapNames ?? {});
  // 手で足した無音区間（CM解析が拾えなかった切れ目。ブロックの区切りに使う）
  const [manualMutes, setManualMutes] = useState<Record<number, TimeRange[]>>(src?.initialMutes ?? {});

  const isAdjusted = manualCuts.length > 0;
  const ic0 = src?.initialCuts ?? [];
  const isModified = manualCuts.length !== ic0.length || manualCuts.some((c, i) => Math.abs(c - ic0[i]!) > 0.5);

  // 元が変わったら、今の分割（initialCuts など）から始め直す
  useEffect(() => {
    if (!src) return;
    const ic = src.initialCuts ?? [];
    setPinnedSegs(new Set()); setPendingKeep(null); setEditingKeep(null);
    setSkipList(src.initialSkips ?? {});
    setKeepList(src.initialKeepList ?? {});
    setChapNames(src.initialChapNames ?? {});
    setManualMutes(src.initialMutes ?? {});
    setManualCuts(ic);
    setManualGaps(ic.map(() => 0));
    setHeadTrimState(0);
    setTrimEndState(src.duration || 0);
    const maxI = Math.max(1, Math.floor((src.duration - 1) / 60 / src.episodeCount));
    const stepMin = ic.length > 0 ? ic[0]! / 60 : null;
    setIntervalMin(stepMin != null ? Math.max(1, Math.round(stepMin)) : Math.min(src.broadcastMin || 30, maxI));
  }, [src]);

  // つなげたら隙間を無くす
  useEffect(() => { if (linked) setManualGaps((p) => p.map(() => 0)); }, [linked]);

  const cuts = useMemo(
    () => (isAdjusted ? [...manualCuts].sort((a, b) => a - b) : autoCuts(total, episodeCount, intervalMin, remainderAt)),
    [isAdjusted, intervalMin, manualCuts, total, remainderAt, episodeCount],
  );
  const noRemainder = src != null && cuts.length === episodeCount - 1;
  const gaps = useMemo(() => (!isAdjusted || linked ? cuts.map(() => 0) : cuts.map((_, i) => Math.max(0, manualGaps[i] || 0))),
    [isAdjusted, linked, cuts, manualGaps]);
  const segments = useMemo(() => segmentsFrom(cuts, gaps, headTrim, trimEnd), [cuts, gaps, headTrim, trimEnd]);

  const addMute = (segIdx: number, from: number, to: number) => setManualMutes((p) => addMuteRange(p, segIdx, from, to));
  const removeMute = (segIdx: number, idx: number) => setManualMutes((p) => ({ ...p, [segIdx]: (p[segIdx] ?? []).filter((_, j) => j !== idx) }));
  const setChapName = (segIdx: number, srcSec: number, name: string) => setChapNames((p) => setChapNameAt(p, segIdx, srcSec, name));
  const updateKeep = (segIdx: number, trimIdx: number, field: 'from' | 'to', val: number) => setKeepList((tl) => updateKeepEdge(tl, segIdx, trimIdx, field, val));
  const renameKeep = (segIdx: number, trimIdx: number, name: string) => setKeepList((tl) => renameKeepAt(tl, segIdx, trimIdx, name));
  const splitKeepAt = (segIdx: number, t: number) => setKeepList((tl) => splitKeepAtTime(tl, segIdx, t));

  // 直し始める: 今の自動の切れ目を手で直す方へ写す
  const ensureManualMode = () => {
    if (!isAdjusted) { setManualCuts(cuts.map((c) => Math.round(c))); setManualGaps(cuts.map(() => 0)); }
  };
  const resetAdjustments = () => {
    const ic = src?.initialCuts ?? [];
    setManualCuts(ic); setManualGaps(ic.map(() => 0));
    setPinnedSegs(new Set());
    setKeepList({}); setPendingKeep(null); setEditingKeep(null);
  };

  const pickInterval = (m: number) => {
    const clamped = Math.max(1, m);
    setIntervalMin(clamped);
    if (pinnedSegs.size === 0) { setManualCuts([]); setManualGaps([]); return; }
    const remIdx = noRemainder ? -1 : remainderAt === 'end' ? segments.length - 1 : 0;
    const nc = intervalCuts(segments, pinnedSegs, clamped * 60, remIdx, total);
    setManualCuts(nc); setManualGaps(nc.map(() => 0));
  };
  const pickRemainderAt = (pos: 'start' | 'end') => {
    setRemainderAt(pos);
    setManualCuts([]); setManualGaps([]);
    setPinnedSegs(new Set());
  };

  // 話数は変えない: N話 + 余り1つを保ち、余りが差を吸う
  const setSegmentDuration = (idx: number, newDur: number) => {
    const nc = resizedCuts(segments, idx, newDur, remainderAt, total);
    if (nc) { setManualCuts(nc); setManualGaps(nc.map(() => 0)); }
  };
  const nudgeSegmentDuration = (idx: number, d: number) => {
    const s = segments[idx];
    setSegmentDuration(idx, (s ? s.end - s.start : intervalMin * 60) + d);
  };
  const resetSegmentToDefault = (idx: number) => setSegmentDuration(idx, intervalMin * 60);
  const toggleSegmentPin = (idx: number, st: SegState) => {
    if (st === 'auto') { ensureManualMode(); setPinnedSegs((p) => new Set([...p, idx])); }
    else if (st === 'fixed') { setPinnedSegs((p) => { const s = new Set(p); s.delete(idx); return s; }); resetSegmentToDefault(idx); }
    else setPinnedSegs((p) => new Set([...p, idx]));
  };

  const setHeadTrim = (t: number) => {
    const sorted = [...cuts].sort((a, b) => a - b);
    const hi = sorted.length ? sorted[0]! - 0.05 : trimEnd - 0.05;
    setHeadTrimState(Math.max(0, Math.min(hi, t)));
  };
  const setLastOut = (t: number) => {
    const sorted = [...cuts].sort((a, b) => a - b);
    const lo = sorted.length ? sorted[sorted.length - 1]! + 0.05 : headTrim + 0.05;
    setTrimEndState(Math.max(lo, Math.min(total, t)));
  };

  // 話の OUT（cuts[idx]）を動かす
  const setOutAt = (idx: number, newOut: number) => {
    ensureManualMode();
    setManualCuts((prev) => {
      const sorted = [...prev].sort((a, b) => a - b);
      if (idx < 0 || idx >= sorted.length) return prev;
      const cur = sorted[idx]!;
      const lo = (idx === 0 ? 0 : sorted[idx - 1]! + (manualGaps[idx - 1] || 0)) + 0.05;
      const hi = linked ? (idx === sorted.length - 1 ? total : sorted[idx + 1]!) - 0.05 : cur + (manualGaps[idx] || 0) - 0.05;
      const clamped = Math.max(lo, Math.min(hi, newOut));
      const delta = clamped - cur;
      sorted[idx] = clamped;
      if (!linked) {
        setManualGaps((g) => {
          const ng = [...g];
          while (ng.length < sorted.length) ng.push(0);
          ng[idx] = Math.max(0, (ng[idx] || 0) - delta);
          return ng;
        });
      }
      return sorted;
    });
  };
  // 話の IN（cuts[idx-1] + gaps[idx-1]）を動かす
  const setInAt = (segIdx: number, newIn: number) => {
    ensureManualMode();
    const cutIdx = segIdx - 1;
    if (cutIdx < 0) { setHeadTrim(newIn); return; }
    if (linked) { setOutAt(cutIdx, newIn); return; }
    setManualGaps((g) => {
      const ng = [...g];
      while (ng.length < manualCuts.length) ng.push(0);
      const cur = manualCuts[cutIdx];
      if (cur == null) return g;
      const hi = (cutIdx === manualCuts.length - 1 ? total : manualCuts[cutIdx + 1]!) - 0.05;
      ng[cutIdx] = Math.max(0, Math.max(cur + 0.05, Math.min(hi, newIn)) - cur);
      return ng;
    });
  };
  const removeCut = (t: number) => {
    ensureManualMode();
    setManualCuts((c) => {
      const idx = c.findIndex((x) => Math.abs(x - t) <= 0.5);
      if (idx < 0) return c;
      setManualGaps((g) => g.filter((_, i) => i !== idx));
      return c.filter((_, i) => i !== idx);
    });
  };

  const buildIndexed = () => buildSegmentsIndexed({ segments, noRemainder, remainderAt, skipList, keepList, manualMutes, chapNames });
  /** 保存する segments（余りの話を落として詰める） */
  const buildSegments = () => buildIndexed().filter((x): x is string => !!x);

  return {
    total, episodeCount, FRAME,
    manualCuts, setManualCuts, manualGaps, setManualGaps,
    linked, setLinked, intervalMin, setIntervalMin,
    pinnedSegs, setPinnedSegs, remainderAt, setRemainderAt,
    keepList, setKeepList, pendingKeep, setPendingKeep,
    editingKeep, setEditingKeep, skipList, setSkipList,
    isAdjusted, isModified, cuts, gaps, segments, noRemainder,
    headTrim, trimEnd, setLastOut,
    updateKeep, renameKeep, splitKeepAt, ensureManualMode,
    chapNames, setChapName, buildSegmentsIndexed: buildIndexed,
    manualMutes, addMute, removeMute, resetAdjustments, pickInterval, pickRemainderAt,
    setSegmentDuration, nudgeSegmentDuration, resetSegmentToDefault, toggleSegmentPin,
    setOutAt, setInAt, removeCut, buildSegments,
  };
}
export type SplitEditor = ReturnType<typeof useSplitEditor>;
