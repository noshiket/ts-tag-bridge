import { fmtDur } from '@tstag/core';
import type { SplitEditor } from '@tstag/core/react';
import { Fragment } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { minSec } from '../common/segmentEditing';
import { SegmentDurationEditor } from '../common/SegmentDurationEditor';
import { Btn, Tag } from '../common/splitButtons';
import { splitColors } from '../common/splitColors';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 分割の設定: 状態・1話の長さ（INTERVAL）・ショートカット・余りの位置・話の長さのチップ（押すと編集） */
export function SplitControls({ ed, total, initialCuts, chipIdx, setChipIdx }: {
  ed: SplitEditor; total: number; initialCuts: number[]; chipIdx: number | null; setChipIdx: (i: number | null) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { episodeCount, isAdjusted, isModified, intervalMin, remainderAt, segments, noRemainder, pinnedSegs, gaps } = ed;
  const parts = segments.map((s) => s.end - s.start);
  const step = intervalMin * 60;
  const remIdx = remainderAt === 'end' ? parts.length - 1 : 0;
  const remDur = parts[remIdx] || 0;
  // 余り＝短い（橙）、1話の長さから外した話＝紫、選んでいる話＝アクセント
  const chipColors = (p: number, i: number, rem: boolean, on: boolean) => {
    const short = rem && p < step - 1;
    const initDur = (initialCuts[i] ?? total) - (i > 0 ? initialCuts[i - 1] ?? 0 : 0);
    const over = isAdjusted && !rem && (pinnedSegs.has(i) || (Math.abs(p - step) > 1 && Math.abs(p - initDur) > 0.5));
    return {
      over,
      bg: on ? accent.primary : short ? oklch(0.92, 0.1, 60) : over ? oklch(0.92, 0.08, 280) : rem ? theme.surface2 : theme.ink,
      fg: on ? '#fff' : short ? oklch(0.35, 0.18, 60) : over ? oklch(0.35, 0.18, 280) : rem ? theme.mute : theme.onInk,
      bd: on ? accent.primary : short ? oklch(0.55, 0.18, 60) : over ? accent.tertiary : rem ? theme.line : theme.ink,
    };
  };
  return (
    <View style={styles.pad}>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
        <View style={styles.row}>
          <Tag bg={isAdjusted ? accent.primary : theme.ink} fg="#fff" border={theme.ink}>{isModified ? 'ADJUSTED' : 'AUTO'}</Tag>
          <Tag bg={theme.surface2} fg={accent.tertiary} border={theme.line}>{tx('common.eps', { v0: episodeCount })}</Tag>
          <T mono size={10} dim style={styles.flex}>{isModified ? tx('split.splitControls.manuallyAdjusted') : tx('split.splitControls.mEachRemainder', { v0: intervalMin, v1: remainderAt === 'start' ? tx('common.start') : tx('split.splitControls.end') })}</T>
          {isModified && <Btn onPress={ed.resetAdjustments}>{tx('split.splitControls.backAuto')}</Btn>}
        </View>
        <View style={styles.row}>
          <T mono size={9} dim style={styles.ls}>{tx('split.splitControls.perEpisode')}</T>
          <View style={styles.flex} />
          <View style={[styles.row, styles.stepper, { borderColor: theme.frame, backgroundColor: theme.surface2 }]}>
            <Pressable onPress={() => ed.pickInterval(Math.max(1, intervalMin - 1))} style={styles.stepBtn}><T mono size={14} w={800}>−</T></Pressable>
            <TextInput value={String(intervalMin)} keyboardType="numeric" onChangeText={(v) => { const n = parseInt(v, 10); if (!Number.isNaN(n) && n >= 1) ed.pickInterval(n); }}
              style={[styles.stepNum, { color: theme.ink }]} />
            <T mono size={10} w={700} dim>m</T>
            <Pressable onPress={() => ed.pickInterval(intervalMin + 1)} style={styles.stepBtn}><T mono size={14} w={800}>{tx('common.plus')}</T></Pressable>
          </View>
        </View>
        <View style={[styles.row, styles.wrap]}>
          <T mono size={8} dim style={styles.ls}>SHORTCUTS</T>
          {[5, 10, 15, 25, 30, 45, 60, 90].map((m) => {
            const on = !isAdjusted && intervalMin === m;
            return <Btn key={m} onPress={() => ed.pickInterval(m)} bg={on ? accent.primary : 'transparent'} fg={on ? '#fff' : theme.mute} border={on ? accent.primary : theme.line} style={{ opacity: isAdjusted ? 0.55 : 1 }}>{`${m}m`}</Btn>;
          })}
        </View>
        <View style={styles.row}>
          <T mono size={9} dim style={styles.ls}>{tx('split.splitControls.where')}</T>
          <View style={styles.flex} />
          <View style={[styles.segCtl, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            {([['start', tx('split.splitControls.start')], ['end', tx('split.splitControls.end2')]] as const).map(([k, l]) => (
              <Pressable key={k} onPress={() => ed.pickRemainderAt(k)} style={[styles.segCtlBtn, remainderAt === k && { backgroundColor: theme.ink }]}>
                <T mono size={10} w={800} color={remainderAt === k ? theme.onInk : theme.mute}>{l}</T>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={[styles.breakdown, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <View style={[styles.row, styles.between]}>
            <T mono size={9} dim>{tx('split.splitControls.tapEdit')}</T>
            <T mono size={9} dim>{tx('split.splitControls.eps', { v0: episodeCount, v1: !noRemainder && (parts[remIdx] ?? 0) > 1 ? ' + None' : '' })}</T>
          </View>
          <View style={[styles.row, styles.wrap]}>
            {parts.map((p, i) => {
              const rem = !noRemainder && ((remainderAt === 'end' && i === parts.length - 1) || (remainderAt === 'start' && i === 0));
              const on = !rem && chipIdx === i;
              const c = chipColors(p, i, rem, on);
              return (
                <Fragment key={i}>
                  {i > 0 && <T mono size={12} w={700} dim style={styles.half}>+</T>}
                  <Pressable disabled={rem} onPress={() => setChipIdx(on ? null : i)}
                    style={[styles.chip, { backgroundColor: c.bg, borderColor: c.bd, borderStyle: rem ? 'dashed' : 'solid', opacity: rem ? (p === 0 ? 0.5 : 0.75) : 1 }]}>
                    <T mono size={11} w={800} color={c.fg}>{rem ? `None${p > 0 ? ` ${minSec(p)}` : ''}` : `${c.over ? '◆ ' : ''}${minSec(p)}`}</T>
                  </Pressable>
                </Fragment>
              );
            })}
          </View>
          {chipIdx != null && chipIdx < parts.length && <SegmentDurationEditor ed={ed} idx={chipIdx} onClose={() => setChipIdx(null)} />}
          <View style={[styles.row, styles.sumRow, { borderTopColor: theme.line }]}>
            <T mono size={10} dim>{tx('split.splitControls.recordingLength')}</T>
            <T mono size={10} w={800}>{fmtDur(total)}</T>
            <View style={styles.flex} />
            {!isAdjusted && remDur > 1 && <T mono size={9} color={oklch(0.35, 0.18, 60)}>{tx('split.splitControls.remainderGoesSegment', { v0: minSec(remDur), v1: remainderAt === 'start' ? tx('common.start') : tx('split.splitControls.last') })}</T>}
            {isAdjusted && gaps.some((g) => g > 0) && <T mono size={9} w={800} color={splitColors.redDark}>{tx('split.splitControls.excluded', { v0: fmtDur(gaps.reduce((s, g) => s + g, 0)) })}</T>}
          </View>
        </View>
        <T mono size={9} dim style={styles.lh}>{tx('split.splitControls.dragCutMarkersTimeline')}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 18, paddingBottom: 12, paddingTop: 4 },
  card: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexWrap: 'wrap', gap: 5 },
  between: { justifyContent: 'space-between' },
  flex: { flex: 1, minWidth: 0 },
  ls: { letterSpacing: 0.6 },
  lh: { lineHeight: 14 },
  half: { opacity: 0.5 },
  stepper: { borderWidth: 1.5, borderRadius: 9, overflow: 'hidden', gap: 0 },
  stepBtn: { width: 28, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  stepNum: { width: 48, textAlign: 'center', fontSize: 14, fontFamily: monoFamily[800], paddingVertical: 4 },
  segCtl: { flexDirection: 'row', alignItems: 'center', padding: 2, borderWidth: 1, borderRadius: 8, gap: 1 },
  segCtlBtn: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 },
  breakdown: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, gap: 7 },
  chip: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1.5 },
  sumRow: { paddingTop: 7, borderTopWidth: 1, borderStyle: 'dashed' },
});
