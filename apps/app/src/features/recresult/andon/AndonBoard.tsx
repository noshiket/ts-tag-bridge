import { StyleSheet, View } from 'react-native';

import { PauseControl } from '../encodeShared';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

export const ANDON = { board: '#1B1B1B', run: '#2FB36B', stop: '#F2B01E', bad: '#E8432E', off: '#333', offText: '#777' };

/**
 * アンドンの板（工場の表示板の作法: 異常を隠さず、ランプと数字で一目で見せる）。
 * 稼働（実行中あり）・停止（止めている）・異常（失敗あり）のランプと、待ち・済・異常の数。右に停止・再開
 */
export function AndonBoard({ running, paused, waiting, done, errors, node }: {
  running: boolean; paused: boolean; waiting: number; done: number; errors: number; node: string | null;
}) {
  const { t: tx } = useT();
  const lamps: [string, boolean, string][] = [[tx('recresult.andon.run'), running && !paused, ANDON.run], [tx('recresult.andon.stop'), paused, ANDON.stop], [tx('recresult.andon.bad'), errors > 0, ANDON.bad]];
  const counts: [string, number, string?][] = [[tx('recresult.andon.waiting'), waiting], [tx('recresult.andon.done'), done], [tx('recresult.andon.bad'), errors, errors > 0 ? ANDON.bad : undefined]];
  return (
    <View style={[styles.board, { backgroundColor: ANDON.board }]}>
      <View style={styles.lamps}>
        {lamps.map(([l, on, c]) => (
          <View key={l} style={[styles.lamp, { backgroundColor: on ? c : ANDON.off }, on && { boxShadow: `0px 0px 10px ${c}` }]}>
            <T size={10} w={900} color={on ? '#fff' : ANDON.offText} style={GOTHIC}>{l}</T>
          </View>
        ))}
      </View>
      {counts.map(([l, n, c]) => (
        <View key={l} style={styles.count}>
          <T size={9} color="#aaa" style={GOTHIC}>{l}</T>
          <Num size={26} color={c ?? '#fff'}>{String(n)}</Num>
        </View>
      ))}
      <PauseControl node={node} />
    </View>
  );
}

const styles = StyleSheet.create({
  board: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  lamps: { gap: 4 },
  lamp: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, alignItems: 'center' },
  count: { flex: 1, borderLeftWidth: 1, borderLeftColor: '#444', paddingLeft: 8 },
});
