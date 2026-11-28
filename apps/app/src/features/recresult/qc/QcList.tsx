import { recProgress, type Recording } from '@tstag/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NG_RED, QcRow } from './QcRow';
import { FILM } from '../sheet/film';
import { GOTHIC, Num } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const GAP = 10;

/**
 * 録画結果の検査票表示。上に完了・処理中・ドロップあり・同じ回ありの数。広い画面は 1 行 380 前後で並べる
 */
export function QcList({ items, node, onOpen, onDelete }: {
  items: Recording[];
  node: string | null;
  onOpen: (r: Recording) => void;
  onDelete: (r: Recording) => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  const [w, setW] = useState(0);
  const done = items.filter((r) => recProgress(r).kind === 'done').length;
  const cols = Math.max(1, Math.floor((w + GAP) / (380 + GAP)));
  const cellW = w > 0 ? (w - GAP * (cols - 1)) / cols : undefined;
  const cells: [string, number, string?][] = [
    [tx('recresult.qc.done'), done, FILM.done], [tx('recresult.qc.working'), items.length - done],
    ['DROP', items.filter((r) => r.drops > 0 || r.scrambles > 0).length, NG_RED],
    [tx('recresult.qc.dupExists'), items.filter((r) => r.duplicate_info?.length).length],
  ];
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={[styles.sum, { borderColor: theme.frame }]}>
        {cells.map(([l, n, c], i) => (
          <View key={l} style={[styles.cell, i > 0 && { borderLeftWidth: 1, borderColor: theme.frame }]}>
            <T size={9} w={700} dim style={GOTHIC}>{l}</T>
            <Num size={22} color={c && n > 0 ? c : theme.ink}>{String(n)}</Num>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {items.map((r) => (
          <View key={r.db_rec_id ?? `e${r.id}`} style={{ width: cellW }}>
            <QcRow r={r} node={node} onDelete={() => onDelete(r)} onOpen={r.db_rec_id != null ? () => onOpen(r) : undefined} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sum: { flexDirection: 'row', borderWidth: 1, marginBottom: 10 },
  cell: { flex: 1, paddingHorizontal: 8, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
});
