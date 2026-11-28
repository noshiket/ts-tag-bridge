import type { Recording } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { Trash } from '../../ui/parts/Icons';
import { Sheet, SheetAction } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { RED } from './colors';
import { useT } from '../../ui/i18n/I18n';

/** 録画結果の削除（EDCB からも消す / EDCB には残す）。元の history.jsx の確認シート */
export function RecDeleteSheet({ r, onClose, onDelete }: {
  r: Recording | null;
  onClose: () => void;
  onDelete: (r: Recording, keepEdcb: boolean) => void;
}) {
  const { theme } = useTheme();
  const { t: tx } = useT();
  return (
    <Sheet open={!!r} onClose={onClose} title={tx('recresult.rec.menu')} subtitle={r?.title}>
      {r && (
        <View style={styles.wrap}>
          <SheetAction bg={RED} icon={<Trash s={15} c="#fff" />} label={tx('recresult.rec.sheet.delete')} sub={`${tx('recresult.rec.sheet.deleteSub')} / EDCB del_rec_info(${r.id})`}
            onPress={() => { onDelete(r, false); onClose(); }} />
          <SheetAction bg="#FF9C3B" icon={<Trash s={15} c="#fff" />} label={tx('recresult.rec.sheet.keepEdcb')} sub={`${tx('recresult.rec.sheet.deleteSub')} / ${tx('recresult.rec.sheet.keepEdcbSub')}`}
            onPress={() => { onDelete(r, true); onClose(); }} />
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
