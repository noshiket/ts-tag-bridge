import { commentsPerMin, recProgress, type Recording } from '@tstag/core';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FILM, useFilm } from './film';
import { RecordingFrame } from './RecordingFrame';
import { GOTHIC } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

const GAP = 8;
const PAD = 14;

/**
 * 録画結果のコンタクトシート表示。1 ページを 1 本のフィルムに見立て、コマを並べて見比べる（地の色はテーマから）
 * （写真のコンタクトシートの作法: 並べて比べ、選んだ跡・問題を紙の上に書き込む）。上にエンコ済・未エンコ・ドロップの数
 */
export function ContactSheet({ items, node, onOpen, onDelete }: {
  items: Recording[];
  node: string | null;
  onOpen: (r: Recording) => void;
  onDelete: (r: Recording) => void;
}) {
  const film = useFilm();
  const { t: tx } = useT();
  const [box, setBox] = useState({ w: 0, h: 0 });
  // 列の数は幅から（スマホは 2 列、広い画面は 1 コマ 170 前後で並べる）。最後の行も同じ大きさにする
  const inner = box.w - PAD * 2;
  const cols = Math.max(2, Math.floor((inner + GAP) / (170 + GAP)));
  const cellW = inner > 0 ? (inner - GAP * (cols - 1)) / cols : 0;
  const done = items.filter((r) => recProgress(r).kind === 'done').length;
  const issues = items.filter((r) => r.drops > 0 || r.scrambles > 0).length;
  const maxPerMin = Math.max(1, ...items.map((r) => commentsPerMin(r.comment_count, r.duration_sec) ?? 0));
  // フィルムの両端の送り穴（高さに合わせた数）
  const holes = (side: 'left' | 'right') => (
    <View pointerEvents="none" style={[styles.holes, { [side]: 1 }]}>
      {Array.from({ length: Math.floor(box.h / 11) }, (_, i) => <View key={i} style={[styles.hole, { backgroundColor: film.hole }]} />)}
    </View>
  );
  return (
    <View style={[styles.base, { backgroundColor: film.base, borderColor: film.hole }]}>
      <View style={styles.sum}>
        <Chip bg={FILM.done} fg="#fff">{tx('recresult.sheet.encoded', { n: done })}</Chip>
        <Chip bg={FILM.idle} fg="#111">{tx('recresult.sheet.notEncoded', { n: items.length - done })}</Chip>
        {issues > 0 && <Chip bg={FILM.pen} fg="#fff">{`DROP ${issues}`}</Chip>}
      </View>
      <View style={[styles.roll, { backgroundColor: film.roll }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {holes('left')}
        {holes('right')}
        {items.map((r) => (
          <View key={r.db_rec_id ?? `e${r.id}`} style={{ width: cellW }}>
            <RecordingFrame r={r} node={node} maxPerMin={maxPerMin} onDelete={() => onDelete(r)}
              onOpen={r.db_rec_id != null ? () => onOpen(r) : undefined} />
          </View>
        ))}
      </View>
    </View>
  );
}

function Chip({ bg, fg, children }: { bg: string; fg: string; children: string }) {
  return <View style={[styles.chip, { backgroundColor: bg }]}><T size={11} w={700} color={fg} style={GOTHIC}>{children}</T></View>;
}

const styles = StyleSheet.create({
  base: { borderRadius: 14, borderWidth: 1, paddingTop: 10, paddingBottom: 8, overflow: 'hidden' },
  sum: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  chip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 2 },
  roll: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', rowGap: 14, columnGap: GAP, paddingVertical: 14, paddingHorizontal: PAD, marginHorizontal: 6 },
  holes: { position: 'absolute', top: 0, bottom: 0, width: 7, justifyContent: 'space-around' },
  hole: { height: 6 },
});
