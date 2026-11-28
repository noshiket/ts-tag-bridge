import { hmsToSec, type CompareJob } from '@tstag/core';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CMP_RED, CmpBtn, cmpStyles, useBoxStyle } from './compareParts';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 2. 解析の進み具合（最後の6行）と、終わったら選び直しへ戻るボタン。
 * 3. 共通の区間（シークバーの上に）と、測ったずれ（音声比較の 500ms 刻みをサンプル単位まで詰めた結果）
 */
export function CompareJobView({ job, dur, onBack }: { job: CompareJob; dur: number; onBack: () => void }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const box = useBoxStyle();
  const matches = job.result?.matches ?? [];
  return (
    <>
      <ScrollView automaticallyAdjustKeyboardInsets style={[box, styles.log]} nestedScrollEnabled>
        {job.state === 'queued' && <T mono size={9} dim>{tx('common.waitingLineOtherAnalysis')}</T>}
        {(job.log ?? []).slice(-6).map((l, i) => <T key={i} mono size={9} dim>{l}</T>)}
        {job.state === 'error' && <T mono size={9} color={CMP_RED}>{job.error ?? ''}</T>}
      </ScrollView>
      {job.state !== 'running' && job.state !== 'queued' && <CmpBtn onPress={onBack} color={theme.mute}>{tx('library.compareJobView.backChoosingSource')}</CmpBtn>}

      {job.state === 'done' && (
        <>
          <T size={10} w={700}>{tx('library.compareJobView.sharedRanges', { v0: matches.length })}</T>
          <View style={[styles.bar, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            {dur > 0 && matches.map((m, i) => {
              const s = hmsToSec(m.videoA.start);
              const e = hmsToSec(m.videoA.end);
              return <View key={i} style={[styles.seg, { left: `${(s / dur) * 100}%`, width: `${Math.max(0.4, ((e - s) / dur) * 100)}%`, backgroundColor: accent.primary }]} />;
            })}
          </View>
          {matches.length === 0 && <T size={10} color={CMP_RED}>{tx('library.compareJobView.noSharedRangesFound')}</T>}
          {matches.length > 0 && !!job.result?.ranges?.length && (
            <View style={box}>
              {job.result.ranges.map((r, i) => {
                const v = job.result?.video?.[i];
                return (
                  <View key={i} style={styles.rangeRow}>
                    <T mono size={9} dim style={cmpStyles.grow}>{`${r.a_start.toFixed(0)}–${r.a_end.toFixed(0)}s`}</T>
                    <T mono size={9}>{`${(r.offset * 1000).toFixed(1)}ms`}</T>
                    {r.coarse_offset != null && r.coarse_offset !== r.offset && <T mono size={9} dim>{`(${(r.coarse_offset * 1000).toFixed(0)}ms → )`}</T>}
                    <T mono size={9} color={v && !v.ok ? CMP_RED : theme.mute}>{!v ? '' : !v.judged ? tx('library.compareJobView.videoStill') : v.ok ? tx('library.compareJobView.videoOk') : tx('common.videoF', { v0: v.frame_offset > 0 ? '+' : '', v1: v.frame_offset })}</T>
                  </View>
                );
              })}
              {(job.result.video ?? []).some((v) => v && v.judged && !v.ok) && <T mono size={9} color={CMP_RED} style={cmpStyles.mt4}>{tx('library.compareJobView.videoOffsetDiffersAudio')}</T>}
              {(job.result.source?.announce || job.result.source?.announce_self) && (
                <T mono size={9} dim style={cmpStyles.mt4}>{tx('library.compareJobView.broadcastNoticePresentPicture', { v0: job.result.source?.announce_self ? tx('library.compareJobView.video') : '', v1: job.result.source?.announce ? tx('library.compareJobView.source') : '' })}</T>
              )}
            </View>
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  log: { maxHeight: 96, paddingVertical: 7, paddingHorizontal: 9 },
  bar: { height: 16, borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  seg: { position: 'absolute', top: 0, bottom: 0, opacity: 0.75 },
  rangeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 9, paddingVertical: 2 },
});
