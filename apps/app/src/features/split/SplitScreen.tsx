import { fmtDur, type SplitSource } from '@tstag/core';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { hms } from './common/segmentEditing';
import { Btn, Tag } from './common/splitButtons';
import { splitColors } from './common/splitColors';
import { CmLegend } from './cm/CmLegend';
import { ScrollLock } from './cm/stripTouch';
import { SegmentCard } from './screen/SegmentCard';
import { SplitControls } from './screen/SplitControls';
import { SplitPreview } from './screen/SplitPreview';
import { SplitTimeline } from './screen/SplitTimeline';
import { useSplitScreen } from './screen/useSplitScreen';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * 録画（TS）を話ごとに分ける画面（元の split.jsx の SplitScreenMain）。録画詳細の「分割」から開く。
 * 編集の中身は再生画面の分割タブと同じ（core の useSplitEditor）。CM解析は参考表示で、ブロックを押した時・CM反映の時だけ分割に入る。
 * 状態と操作は screen/useSplitScreen、部品は screen/（分割画面）・cm/（CM解析）・common/（タブと共通）
 */
export function SplitScreen({ src, node, onDone, topBar }: { src: SplitSource; node: string | null; onDone: () => void; topBar: ReactNode }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const wide = useWindowDimensions().width >= 900;
  const s = useSplitScreen(src, node, onDone);
  const { ed, total, cmq } = s;
  // なぞる帯・切れ目のつまみを触っている間は下の ScrollView を止める（cm/stripTouch の ScrollLock）
  const [scrollLocked, setScrollLocked] = useState(false);
  const { linked } = ed;
  const outputSec = ed.segments.reduce((sum, x) => sum + (x.end - x.start), 0);

  const rest = (
    <>
      <View style={styles.pad}>
        <SplitTimeline src={src} ed={ed} playhead={s.playhead} onSeek={s.seek} cm={cmq.cm} inputChapters={cmq.inputChapters} decls={cmq.decls} />
        <View style={[styles.row, styles.between, styles.mt5]}>
          <T mono size={9} dim>00:00:00</T><T mono size={9} dim>{hms(total / 2)}</T><T mono size={9} dim>{hms(total)}</T>
        </View>
        <CmLegend cm={cmq.cm} total={total} job={cmq.job} error={cmq.error} onStart={cmq.start} onRerunAddons={cmq.rerunAddons} addonBusy={cmq.addonBusy} addonMsg={cmq.addonMsg} decls={cmq.decls} addonLabels={cmq.addonLabels} />
      </View>

      {/* ファイルの情報 */}
      <View style={styles.pad}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
          <T size={12} w={800} numberOfLines={1}>{src.name}</T>
          <View style={[styles.row, styles.mt4]}>
            <Tag bg={theme.ink} fg={theme.onInk}>{tx('split.splitScreen.length', { v0: fmtDur(total) })}</Tag>
            <Tag bg={theme.surface2} fg={theme.ink} border={theme.line}>{tx('split.splitScreen.airTimeM', { v0: src.broadcastMin })}</Tag>
          </View>
        </View>
      </View>

      {/* つなげる / 離す */}
      <View style={styles.pad}>
        <View style={[styles.row, styles.linkBox, { backgroundColor: linked ? theme.surface : 'rgba(255,214,209,0.35)', borderColor: linked ? theme.line : splitColors.red }]}>
          <Btn onPress={() => ed.setLinked((v) => !v)} bg={linked ? accent.primary : theme.surface} fg={linked ? '#fff' : splitColors.redDark} border={linked ? accent.primary : splitColors.red}>{linked ? '⛓ LINKED' : '✂ UNLINKED'}</Btn>
          <T mono size={10} color={linked ? theme.mute : splitColors.redDark} style={styles.flex}>
            {linked ? tx('split.screen.linked') : tx('split.splitScreen.nextIndependentGapBetween')}
          </T>
        </View>
      </View>

      <SplitControls ed={ed} total={total} initialCuts={src.initialCuts} chipIdx={s.chipIdx} setChipIdx={s.setChipIdx} />

      {/* 出力（話ごと） */}
      <View style={styles.pad}>
        <View style={[styles.row, styles.between, styles.mb8]}>
          <T mono size={10} dim style={styles.ls}>{tx('common.eps2', { v0: ed.episodeCount })}</T>
          <T mono size={9} dim>{ed.gaps.some((g) => g > 0) ? tx('split.screen.outRec', { o: fmtDur(outputSec), r: fmtDur(total) }) : tx('split.screen.total', { t: fmtDur(total) })}</T>
        </View>
        {ed.segments.map((seg, i) => <SegmentCard key={i} s={s} seg={seg} i={i} />)}
      </View>

      <View style={styles.pad}>
        {!!s.saveErr && <T mono size={10} color={splitColors.red} style={styles.mb8}>{s.saveErr}</T>}
        <Pressable onPress={() => void s.apply()} disabled={s.saving}
          style={[styles.apply, { backgroundColor: accent.primary, borderColor: theme.frame, boxShadow: shadow(theme, 3), opacity: s.saving ? 0.6 : 1 }]}>
          <T size={13} w={800} color="#fff">{s.saving ? tx('common.applying') : tx('common.apply')}</T>
        </Pressable>
      </View>
    </>
  );
  const scroll = (style: object) => (
    <ScrollView automaticallyAdjustKeyboardInsets style={style} contentContainerStyle={styles.bottom} scrollEnabled={!scrollLocked}>
      <ScrollLock.Provider value={setScrollLocked}>{rest}</ScrollLock.Provider>
    </ScrollView>
  );

  // PC: 左にプレビュー、右にタイムライン以降（元の 2fr:3fr）。スマホ: プレビューを上に留めて下を流す
  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      {topBar}
      {wide ? (
        <View style={[styles.flex, styles.grid]}>
          <View style={styles.left}><SplitPreview s={s} /></View>
          {scroll(styles.right)}
        </View>
      ) : (
        <>
          <SplitPreview s={s} />
          {scroll(styles.flex)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pad: { paddingHorizontal: 18, paddingBottom: 12, paddingTop: 4 },
  bottom: { paddingBottom: 120 },
  grid: { flexDirection: 'row', alignItems: 'flex-start' },
  left: { flex: 2 },
  right: { flex: 3, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  between: { justifyContent: 'space-between' },
  ls: { letterSpacing: 0.6 },
  mt4: { marginTop: 4 },
  mt5: { marginTop: 5 },
  mb8: { marginBottom: 8 },
  card: { borderWidth: 1.5, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  linkBox: { paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1.5, borderRadius: 10, gap: 8 },
  apply: { padding: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
});
