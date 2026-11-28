import type { EncodeRow } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { JOB_RED } from './jobShared';
import type { JobActions } from './useJobActions';
import { Trash } from '../../ui/parts/Icons';
import { Sheet } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** 「…」の操作（make_DB のみ・エンコードスキップ・削除）と、削除の確認（アプリの中のシートで。元と同じ） */
export function JobMenuSheets({ e, a }: { e: EncodeRow; a: JobActions }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const btn = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.btn, { borderColor: theme.frame }]}><T mono size={13} w={700}>{label}</T></Pressable>
  );
  return (
    <>
      <Sheet open={a.moreOpen} onClose={() => a.setMoreOpen(false)} title="EXPERIMENTAL">
        <View style={styles.gap8}>
          {btn(tx('encoding.jobMenuSheets.runMakeOnly'), a.makeDbOnly)}
          {e.recordingId != null && btn(tx('encoding.jobMenuSheets.skipEncoding'), a.skip)}
          <Pressable onPress={() => { a.setMoreOpen(false); a.setConfirmDel(true); }} style={[styles.btn, { backgroundColor: JOB_RED, borderColor: theme.frame }]}>
            <Trash s={14} c="#fff" /><T mono size={13} w={800} color="#fff">{tx('encoding.jobMenuSheets.deleteDbRecordingStays')}</T>
          </Pressable>
        </View>
      </Sheet>
      <Sheet open={a.confirmDel} onClose={() => a.setConfirmDel(false)} title={tx('encoding.jobMenuSheets.deleteEncode')}>
        <View style={[styles.confirm, { backgroundColor: theme.surface2 }]}>
          <T mono size={10} dim>
            {tx('encoding.jobMenuSheets.recordingKept', { v0: e.id, v1: e.title, v2: e.state === 'encoding' ? tx('encoding.jobMenuSheets.encodingSoAmatsukazeTask') : '' })}
          </T>
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => a.setConfirmDel(false)} style={[styles.btn, styles.grow, { borderColor: theme.frame }]}><T size={13} w={700}>{tx('common.cancel')}</T></Pressable>
          <Pressable onPress={a.del} style={[styles.btn, styles.grow, { backgroundColor: JOB_RED, borderColor: theme.frame }]}><T size={13} w={800} color="#fff">{tx('common.delete2')}</T></Pressable>
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  gap8: { gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', padding: 13, borderRadius: 13, borderWidth: 1.5 },
  confirm: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 16 },
});
