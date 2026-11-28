import { fmtMs } from '@tstag/core';
import { StyleSheet, View } from 'react-native';

import { Btn } from '../common/splitButtons';
import type { SplitPlayerCtl } from './SplitTab';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 分割タブの上の「編集点」: 再生・一時停止、編集点の時刻と厳密なコマ番号、コマ・秒送り。コマは本体の画面（止めている間）に出る */
export function TabEditPoint({ ctl, frame, efn, status }: { ctl: SplitPlayerCtl; frame: number; efn: (t: number) => number; status: string | null }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const t = ctl.focusT || 0;
  return (
    <View style={[styles.box, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
      <View style={styles.row}>
        <Btn onPress={() => (ctl.paused ? ctl.play() : ctl.pause())} bg={accent.primary} fg="#fff" style={styles.play}>{ctl.paused ? '▶' : '⏸'}</Btn>
        <T mono size={9} dim>{tx('split.tabEditPoint.editPoint')}</T>
        <View style={[styles.focus, { backgroundColor: theme.ink }]}>
          <T mono size={11} w={800} color={theme.onInk}>{`${fmtMs(t)} #${efn(t)} `}</T>
          <T mono size={8} w={800} color={status === 'ready' ? '#7CFC9E' : status === 'building' ? '#FFD60A' : '#bbb'}>
            {status === 'ready' ? '厳密' : status === 'building' ? '生成中…' : '近似'}
          </T>
        </View>
      </View>
      <View style={styles.row3}>
        {([['◀F', -frame], ['−1s', -1], ['−.1', -0.1], ['+.1', 0.1], ['+1s', 1], ['F▶', frame]] as const).map(([l, d]) => (
          <Btn key={l} onPress={() => ctl.stepFocus(d)} style={styles.flex}>{l}</Btn>
        ))}
      </View>
      <T mono size={8} dim style={styles.lh}>{ctl.paused ? tx('split.tabEditPoint.mainViewShowsFrame') : tx('split.tabEditPoint.playingPauseShowEdit')}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row3: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  flex: { flex: 1 },
  lh: { lineHeight: 12 },
  play: { width: 30, paddingHorizontal: 4 },
  focus: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 4, borderRadius: 6 },
});
