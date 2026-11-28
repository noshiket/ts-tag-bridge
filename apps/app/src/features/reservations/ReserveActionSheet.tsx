import type { Reserve } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { Sheet, SheetAction } from '../../ui/sheets/Sheet';
import { Skip, Trash } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** 予約の操作（スキップ＝予約は残す / 削除＝予約を消す）。元の reservations.jsx の確認シート */
export function ReserveActionSheet({ r, onClose, onSkip, onDelete }: {
  r: Reserve | null;
  onClose: () => void;
  onSkip: (r: Reserve) => void;
  onDelete: (r: Reserve) => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  return (
    <Sheet open={!!r} onClose={onClose} title={tx('reservations.list.menu')} subtitle={r?.title}>
      {r && (
        <View style={styles.wrap}>
          <SheetAction bg="#FF9C3B" icon={<Skip s={15} c="#fff" />} label={tx('reservations.list.sheet.skip')} sub={`change_reserve(recEnabled=0) — ${tx('reservations.list.sheet.skipSub')}`}
            onPress={() => { onSkip(r); onClose(); }} />
          <SheetAction bg="#E62B34" icon={<Trash s={15} c="#fff" />} label={tx('reservations.list.sheet.delete')} sub={`del_reserve(${r.reserve_id}) — ${tx('reservations.list.sheet.deleteSub')}`}
            onPress={() => { onDelete(r); onClose(); }} />
          <Pressable onPress={onClose} style={[styles.cancel, { borderColor: theme.line }]}>
            <T size={13} w={700} dim>{tx('common.cancel')}</T>
          </Pressable>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  cancel: { padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center', marginTop: 4 },
});
