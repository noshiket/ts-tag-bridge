import { AMZ_FPS, frameNo } from '@tstag/core';
import { useApi, useExactFrames, type SplitEditor } from '@tstag/core/react';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { segmentEditing } from '../common/segmentEditing';
import { TabEditPoint } from './TabEditPoint';
import { TabSegmentCard } from './TabSegmentCard';
import { TabSplitSettings } from './TabSplitSettings';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 分割タブから本体のプレイヤーを動かす（元の playerCtl） */
export interface SplitPlayerCtl {
  focusT: number;
  paused: boolean;
  stepFocus: (d: number) => void;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * 録画の再生画面の「分割」（元の stream_right_tab_split.jsx）: 分割画面と同じ編集を右のパネルに収めたもの。
 * コマの表示は本体（止めている間は編集点の厳密なコマを重ねる）、切れ目はシークバーに重ねる。ここは編集点の操作と一覧の編集
 */
export function SplitTab({ dbRecId, node, editor, ctl }: { dbRecId: number; node: string | null; editor: SplitEditor; ctl: SplitPlayerCtl }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const { episodeCount, FRAME, cuts, segments, keepList, buildSegments } = editor;
  const focusT = ctl.focusT;

  // 厳密なコマ番号（トリムの端・切れ目・編集点）をサーバーで引く
  const exTimes = useMemo(() => [
    ...Object.values(keepList).flat().flatMap((tr) => [tr.from, tr.to]), ...cuts, Math.round((focusT || 0) * 1000) / 1000,
  ], [keepList, cuts, focusT]);
  const { exactFrame, status } = useExactFrames(dbRecId, node, exTimes);
  const efn = (t: number) => exactFrame(t) ?? frameNo(t, FRAME > 0 ? 1 / FRAME : AMZ_FPS);
  const editing = segmentEditing(editor, ctl.seek);

  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const apply = async () => {
    if (saving) return;
    setSaving(true); setSaved(false);
    try { await api.recordings.setSegments(dbRecId, buildSegments(), node); setSaved(true); setTimeout(() => setSaved(false), 2500); } catch { /* 元と同じく何もしない */ }
    setSaving(false);
  };

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.wrap}>
      <TabEditPoint ctl={ctl} frame={FRAME} efn={efn} status={status} />
      <TabSplitSettings editor={editor} isNone={editing.isNone} />
      <T mono size={9} dim style={styles.ls}>{tx('common.eps2', { v0: episodeCount })}</T>
      {segments.map((s, i) => (
        <TabSegmentCard key={i} dbRecId={dbRecId} node={node} editor={editor} editing={editing} seg={s} i={i}
          open={selected === i} onToggle={() => setSelected(selected === i ? null : i)} focusT={focusT} efn={efn} jumpTo={ctl.seek} />
      ))}
      <Pressable onPress={() => void apply()} disabled={saving}
        style={[styles.apply, { backgroundColor: saved ? '#2E9E4F' : accent.primary, borderColor: theme.frame, boxShadow: shadow(theme, 2), opacity: saving ? 0.6 : 1 }]}>
        <T size={13} w={800} color="#fff">{saving ? tx('common.applying') : saved ? tx('split.splitTab.applied') : tx('common.apply')}</T>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 12, gap: 10 },
  ls: { letterSpacing: 1, marginTop: 2 },
  apply: { padding: 11, borderRadius: 11, borderWidth: 1.5, alignItems: 'center' },
});
