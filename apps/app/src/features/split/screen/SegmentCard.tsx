import { cmKeepsFor, fmtDur, fmtMs, type SplitSegment } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Btn, Tag, TimeRow } from '../common/splitButtons';
import { splitColors } from '../common/splitColors';
import { BlockStrip } from '../cm/BlockStrip';
import { MarkStrip } from '../cm/MarkStrip';
import { ChapterBand } from '../cm/SegmentCmBands';
import { SegmentScrubBar } from './SegmentScrubBar';
import { SegmentTrimEditor } from './SegmentTrimEditor';
import type { SplitScreenState } from './useSplitScreen';
import { Chev } from '../../../ui/parts/Icons';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 出力の1話のカード: 名前・時刻・SKIP・その位置へ。押して開くと、区切りへ飛ぶ▼の帯・スクラブバー・章の帯・CMのブロック帯、
 * この話の再生、手で足す無音、IN / OUT、隙間、採用区間（トリム）
 */
export function SegmentCard({ s, seg, i }: { s: SplitScreenState; seg: SplitSegment; i: number }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const { ed, editing, seek, playhead, playing, cmq } = s;
  const dur = seg.end - seg.start;
  const sel = s.selected === i;
  const last = i === ed.segments.length - 1;
  const none = editing.isNone(i);
  const skip = !none && (ed.skipList[i] || seg.start === seg.end);
  const inSeg = playhead >= seg.start && playhead <= seg.end;
  const manual = ed.manualMutes[i] ?? [];
  const sk = skip ? splitColors.skipOn : splitColors.skipOff;
  return (
    <View style={[styles.card, { backgroundColor: none ? theme.surface2 : theme.surface, borderColor: sel ? accent.primary : none ? theme.line : theme.frame,
      borderStyle: none ? 'dashed' : 'solid', boxShadow: none ? undefined : shadow(theme, 2, sel ? accent.primary : theme.ink), opacity: none ? 0.7 : skip ? 0.5 : 1 }]}>
      <Pressable onPress={() => s.setSelected(sel ? null : i)} style={styles.row}>
        <View style={[styles.thumb, { borderColor: none ? theme.line : theme.frame, borderStyle: none ? 'dashed' : 'solid' }]}>
          {!none && <Image source={{ uri: api.recordings.frameUrl(s.src.dbRecId, Math.round(seg.start), s.node), headers: api.client.authHeaders() }} contentFit="cover" style={StyleSheet.absoluteFill} />}
          <View style={[styles.thumbTag, { backgroundColor: none ? theme.surface : 'rgba(0,0,0,0.55)' }]}>
            <T mono size={8} w={800} color={none ? theme.mute : '#fff'}>{none ? '×' : `#${String(seg.idx).padStart(2, '0')}`}</T>
          </View>
        </View>
        <View style={styles.flex}>
          <View style={styles.row}>
            <T size={11} w={800} dim={none} style={skip ? styles.strike : undefined}>{none ? tx('split.segmentCard.noneNotOutput') : `${s.nameFor(ed.remainderAt === 'start' ? i - 1 : i)}.ts`}</T>
            {skip && <Tag bg={oklch(0.55, 0.2, 25)} fg="#fff">SKIP</Tag>}
          </View>
          <T mono size={9} dim>{`${fmtMs(seg.start)} → ${fmtMs(seg.end)} · ${fmtDur(dur)} · ${((dur / s.total) * 100).toFixed(1)}%`}</T>
        </View>
        {!none && dur > 0 && <Btn onPress={() => editing.toggleSkip(i)} bg={sk.bg} fg={sk.fg} border={sk.border}>{skip ? 'ON' : 'SKIP'}</Btn>}
        <Btn onPress={() => seek(seg.start)}>jump</Btn>
        <Chev s={11} c={theme.mute} d={sel ? 'up' : 'down'} />
      </Pressable>

      {sel && (
        <View style={[styles.detail, { borderTopColor: theme.line }]}>
          {!none && (
            <>
              <MarkStrip cm={cmq.cm} seg={seg} manual={manual} onJump={seek} decls={cmq.decls} />
              <SegmentScrubBar s={s} seg={seg} i={i} />
              <ChapterBand chapters={cmq.segChapters[i] ?? []} seg={seg} onSeek={seek} />
              <BlockStrip cm={cmq.cm} seg={seg} segIdx={i} keeps={ed.keepList[i] ?? []} manual={manual} chapters={cmq.segChapters[i] ?? []} onFlip={s.flip} />
              <View style={styles.row}>
                <Btn onPress={() => { seek(seg.start); s.setPlaying(false); }} style={styles.icon}>|◀</Btn>
                <Pressable onPress={() => { if (playing && inSeg) s.setPlaying(false); else { seek(seg.start); s.setPlaying(true); } }}
                  style={[styles.segPlay, { backgroundColor: playing && inSeg ? theme.ink : accent.primary, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
                  <T mono size={10} w={800} color="#fff">{playing && inSeg ? tx('split.segmentCard.pause') : tx('split.segmentCard.play')}</T>
                </Pressable>
                <Btn onPress={() => { seek(seg.end); s.setPlaying(false); }} style={styles.icon}>▶|</Btn>
                {cmq.cm && cmKeepsFor(cmq.cm, seg).length > 0 && <Btn onPress={() => s.applyCmKeeps(i, seg)} style={styles.icon}>{tx('split.segmentCard.applyCm')}</Btn>}
              </View>
              {/* 手で足す無音区間（CM解析が拾えなかった切れ目。ブロックの区切りになる） */}
              <View style={[styles.row, styles.wrap]}>
                <T mono size={8} dim>{tx('split.segmentCard.silentRangeManual')}</T>
                <Btn onPress={() => ed.addMute(i, playhead, playhead + 1)}>{tx('split.segmentCard.plusLabel', { v0: fmtMs(playhead) })}</Btn>
                {manual.map((mu, mi) => (
                  <View key={mi} style={[styles.row, styles.muteChip, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                    <Pressable onPress={() => seek(mu.from)}><T mono size={9} w={800}>{fmtMs(mu.from)}</T></Pressable>
                    <Pressable onPress={() => ed.removeMute(i, mi)}><T size={9} dim>×</T></Pressable>
                  </View>
                ))}
              </View>
            </>
          )}
          <TimeRow label="IN" t={seg.start} efn={s.efn} frame={ed.FRAME} onNudge={(d) => editing.nudgeIn(i, d)} onJump={() => seek(seg.start)} onSet={() => ed.setInAt(i, playhead)} />
          <TimeRow label="OUT" t={seg.end} efn={s.efn} frame={ed.FRAME} onNudge={(d) => editing.nudgeOut(i, d)} onJump={() => seek(seg.end)} onSet={last ? () => ed.setLastOut(playhead) : () => ed.setOutAt(i, playhead)} />
          {seg.gapAfter > 0 && !last && (
            <View style={[styles.row, styles.gapRow, { borderColor: splitColors.red }]}>
              <T mono size={9} w={800} color={splitColors.redDark}>× GAP</T>
              <T mono size={9} color={splitColors.redDark} style={styles.flex}>{tx('split.segmentCard.excludeOutput', { v0: fmtDur(seg.gapAfter) })}</T>
              <Btn onPress={() => { ed.ensureManualMode(); ed.setManualGaps((g) => { const ng = [...g]; ng[i] = 0; return ng; }); }} bg={splitColors.redDark} fg="#fff" border={splitColors.redDark}>{tx('common.close')}</Btn>
            </View>
          )}
          {!none && <SegmentTrimEditor s={s} i={i} />}
          <T mono size={9} dim style={styles.lh}>{`· ${ed.linked ? 'リンクON: OUTを動かすと次のINも同期します' : 'リンクOFF: OUTを前にずらすと次のINはそのまま、間にギャップが生じるようになります'}`}</T>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 12, padding: 10, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wrap: { flexWrap: 'wrap', gap: 5 },
  flex: { flex: 1, minWidth: 0 },
  lh: { lineHeight: 14 },
  strike: { textDecorationLine: 'line-through' },
  icon: { minWidth: 30, height: 30, justifyContent: 'center' },
  thumb: { width: 56, height: 34, borderRadius: 6, overflow: 'hidden', borderWidth: 1.5, backgroundColor: '#222' },
  thumbTag: { position: 'absolute', top: 2, left: 3, paddingVertical: 1, paddingHorizontal: 4, borderRadius: 3 },
  detail: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderStyle: 'dashed', gap: 6 },
  segPlay: { flex: 1, height: 30, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  muteChip: { paddingVertical: 2, paddingHorizontal: 5, borderRadius: 5, borderWidth: 1, gap: 3 },
  gapRow: { paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'rgba(255,214,209,0.4)' },
});
