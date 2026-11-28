import { logoProgress } from '@tstag/core';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { LogoBtn, LogoNote, logoStyles as ls } from './logoParts';
import type { LogoJob } from './useLogoJob';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/** 失敗の知らせ・進み具合（検出したコマ数/読み込み/pass）・できたロゴと登録/破棄 */
export function LogoProgress({ j, wantFrames }: { j: LogoJob; wantFrames: number }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { job, amz, done } = j;
  const pct = amz ? logoProgress(amz.numValid, wantFrames) : 0;
  return (
    <>
      {job?.state === 'error' && (
        <View style={styles.err}>
          <T size={11} w={700} color="#F0444F">{tx('player.logoProgress.couldntCreateLogo')}</T>
          <T mono size={9} dim style={ls.lh}>{job.error ?? ''}</T>
          <LogoNote>{tx('player.logoProgress.rangeKeptReEnclose')}</LogoNote>
        </View>
      )}
      {(j.running || done) && (
        <View style={ls.mt10}>
          <View style={[styles.bar, { backgroundColor: theme.surface2 }]}>
            <View style={[styles.fill, { width: `${done ? 100 : pct}%`, backgroundColor: accent.primary }]} />
          </View>
          <LogoNote style={ls.mt4}>{`${done ? '完了' : `${pct}%`}${amz ? ` — 検出 ${amz.numValid || 0}/${wantFrames} / 読み込み ${amz.numRead || 0} / pass ${amz.pass || 1}` : ''}`}</LogoNote>
        </View>
      )}
      {done && j.imgSrc && (
        <View style={ls.mt10}>
          <Image source={j.imgSrc} contentFit="contain" style={[styles.logo, { borderColor: theme.line }]} />
          <View style={[ls.row, ls.mt8]}>
            <LogoBtn on disabled={j.busy} onPress={() => j.finish(true)}>{tx('player.logoProgress.registerLogo')}</LogoBtn>
            <LogoBtn disabled={j.busy} onPress={() => j.finish(false)}>{tx('player.logoProgress.discard')}</LogoBtn>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  err: { marginTop: 10, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1, borderColor: '#E62B34', backgroundColor: 'rgba(230,43,52,0.12)', gap: 3 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%' },
  logo: { width: '100%', aspectRatio: 4, borderRadius: 6, borderWidth: 1, backgroundColor: '#000' },
});
