import { AMZ_FPS, cmKeepsFor, flipBlocks, frameNo, type Block, type SplitSource } from '@tstag/core';
import { useApi, useExactFrames, useRecordingProbe, useSplitEditor } from '@tstag/core/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { segmentEditing } from '../common/segmentEditing';
import { useCmAnalysis } from '../cm/useCmAnalysis';

/**
 * 分割画面の状態と操作: 編集（core の useSplitEditor）、再生位置（静止画のコマ・再生）、厳密なコマ番号、
 * CM解析、ブロックの反転・CM反映、反映（保存）
 */
export function useSplitScreen(src: SplitSource, node: string | null, onDone: () => void) {
  const api = useApi();
  const total = src.duration;
  // 放送の 29.97 は丸めた値なので、Amatsukaze と同じ 30000/1001 にそろえる（コマ送りとコマ番号を合わせる）
  const probe = useRecordingProbe(src.dbRecId, node);
  const f = probe.data?.video?.fps ?? 0;
  const fps = f > 0 ? (Math.abs(f - 29.97) < 0.005 ? AMZ_FPS : f) : AMZ_FPS;
  const ed = useSplitEditor(src, fps);
  const { cuts, segments, keepList, skipList, manualMutes, pendingKeep } = ed;

  const [playhead, setPlayhead] = useState(0);
  // 解析の印へ飛んだ時はフレーム番号も覚え、静止画はその番号で引く（秒へ直して引き直すとずれる）
  const [playheadFrame, setPlayheadFrame] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const seekStart = useRef(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [chipIdx, setChipIdx] = useState<number | null>(null);
  useEffect(() => { setPlayhead(0); setPlaying(false); setSelected(null); setChipIdx(null); }, [src]);

  const seek = (t: number, frame?: number | null) => { const c = Math.max(0, Math.min(total, t)); seekStart.current = c; setPlayhead(c); setPlayheadFrame(frame ?? null); };
  const nudge = (d: number) => seek(playhead + d);
  const jumpCut = (dir: 1 | -1) => {
    const pts = [0, ...cuts, total].sort((a, b) => a - b);
    const to = dir > 0 ? pts.find((t) => t > playhead + 0.5) : [...pts].reverse().find((t) => t < playhead - 0.5);
    if (to != null) seek(to);
  };
  const togglePlay = () => { if (!playing) seekStart.current = playhead; setPlaying(!playing); };

  // トリムの端・切れ目・再生位置の厳密なコマ番号（引けなければ近い値）
  const exTimes = useMemo(() => [...Object.values(keepList).flat().flatMap((tr) => [tr.from, tr.to]), ...cuts, Math.round(playhead * 1000) / 1000], [keepList, cuts, playhead]);
  const { exactFrame, status: frameStatus } = useExactFrames(src.dbRecId, node, exTimes);
  const efn = (t: number) => exactFrame(t) ?? frameNo(t, fps);
  const efPreview = (from: number, to: number) => `#${efn(from)}-${Math.max(efn(from), efn(to) - 1)}`;

  const editing = segmentEditing(ed, seek);
  /** 出力の名前（確定値の出力パスがあればその名前） */
  const nameFor = (i: number) => {
    const p = src.outputPaths[i];
    if (p) return p.split('/').pop()!.replace(/\.[^.]+$/, '');
    return segments.length === 1 ? src.baseTitle : `${src.baseTitle}_part${String(i + 1).padStart(2, '0')}`;
  };

  const cmq = useCmAnalysis(src.dbRecId, node, ed.buildSegmentsIndexed, JSON.stringify([segments, keepList, skipList, ed.chapNames, manualMutes]));
  // ブロックを押す・なぞる: 採用/除外を反転し、隣り合う採用は1区間にまとめる
  const flip = (i: number, blocks: Block[], hit: (b: Block) => boolean) => { ed.ensureManualMode(); ed.setKeepList((t) => ({ ...t, [i]: flipBlocks(blocks, t[i] ?? [], hit) })); };
  // CM解析の残す区間を、この話の採用区間としてそのまま入れる
  const applyCmKeeps = (i: number, sg: { start: number; end: number }) => {
    const ks = cmKeepsFor(cmq.cm, sg, manualMutes[i] ?? [], keepList[i] ?? []);
    if (!ks.length) return;
    ed.ensureManualMode(); ed.setKeepList((t) => ({ ...t, [i]: ks }));
  };

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const apply = async () => {
    setSaving(true); setSaveErr(null);
    try { await api.recordings.setSegments(src.dbRecId, ed.buildSegments(), node); onDone(); } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); }
    setSaving(false);
  };

  // 採用区間の外（出力に残らない所）を見ているか
  const segAt = segments.findIndex((s) => playhead >= s.start && playhead <= s.end);
  const keepsAt = segAt >= 0 ? keepList[segAt] ?? [] : [];
  const removed = pendingKeep === null && keepsAt.length > 0 && !keepsAt.some((k) => playhead >= k.from && playhead <= k.to);

  return {
    src, node, total, ed, editing, cmq, playhead, setPlayhead, playheadFrame, setPlayheadFrame, playing, setPlaying, togglePlay, seekStart,
    seek, nudge, jumpCut, efn, efPreview, frameStatus, nameFor, flip, applyCmKeeps, saving, saveErr, apply, removed,
    selected, setSelected, chipIdx, setChipIdx,
  };
}

export type SplitScreenState = ReturnType<typeof useSplitScreen>;
