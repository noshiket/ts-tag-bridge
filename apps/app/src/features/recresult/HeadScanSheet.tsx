import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Sheet } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * 録画詳細の「…」→ 冒頭からずらして番組情報を取得。録画の最初から何秒後の時点で放送中だった番組の
 * 情報を読み直す（ふだんの取り込みは録画全体で一番長く放送中だった番組なので、別の番組が欲しい時に使う）。
 * 空なら予約の開始マージン + 15 秒。結果は onMessage で見出しの横に出す
 */
export function HeadScanSheet({ id, node, open, onClose, onMessage, onChanged }: {
  id: number;
  node: string | null;
  open: boolean;
  onClose: () => void;
  onMessage: (m: string, ms?: number) => void;
  onChanged: () => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [sec, setSec] = useState('');
  const run = async () => {
    const v = sec.trim();
    if (v && !/^\d+$/.test(v)) { onMessage(tx('recresult.headScan.invalid'), 3000); return; }
    onClose(); onMessage(tx('recresult.headScan.running'));
    try {
      const r = await api.recordings.scanEitHead(id, v ? Number(v) : null, node);
      onMessage(tx('recresult.headScan.done', { sec: r.offset_sec ?? '', title: r.title ?? '' }), 5000);
      onChanged();
    } catch (e) {
      onMessage(tx('common.failed', { v0: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={tx('recresult.headScan.title')}>
      <T size={11} dim style={styles.note}>{tx('recresult.headScan.note')}</T>
      <View style={styles.row}>
        <TextInput value={sec} onChangeText={setSec} onSubmitEditing={() => void run()} keyboardType="number-pad" inputMode="numeric"
          placeholder={tx('recresult.headScan.placeholder')} placeholderTextColor={theme.mute}
          style={[styles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
        <T size={12} w={700}>{tx('recresult.headScan.seconds')}</T>
      </View>
      <Pressable onPress={() => void run()} style={[styles.btn, { backgroundColor: accent.primary }]}>
        <T size={13} w={800} color="#fff">{tx('recresult.headScan.run')}</T>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: 6, lineHeight: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  btn: { marginTop: 12, padding: 13, borderRadius: 13, alignItems: 'center' },
});
