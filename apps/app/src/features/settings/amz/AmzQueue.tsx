import type { AmzQueueItem } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AMZ_RED, amzStyles } from './amzStyles';
import { Card } from '../parts';
import { confirmAsync } from '../../../lib/device/confirm';
import { useViewNode } from '../../../lib/state/viewNode';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** キュー / QUEUE: Amatsukaze のキュー（中止・削除。削除は作業フォルダも消す）。サーバーを切り替えたら取り直す */
export function AmzQueue() {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const { viewNode } = useViewNode();
  const [queue, setQueue] = useState<AmzQueueItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try { setQueue((await api.amatsukaze.queue(viewNode)).items ?? []); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setQueue([]); } finally { setBusy(false); }
  }, [api, viewNode]);
  useEffect(() => { void load(); }, [load]);

  const act = async (it: AmzQueueItem, type: 'Cancel' | 'RemoveItem', confirmMsg?: string) => {
    if (confirmMsg && !(await confirmAsync(confirmMsg, tx('reservations.list.sheet.delete')))) return;
    setWorking((w) => ({ ...w, [it.id]: true }));
    setNote(null);
    try {
      const r = await api.amatsukaze.changeQueue(it.id, type, viewNode);
      if (r?.removed_amt_dir) setNote(tx('settings.amzQueue.deleteTempFolder', { v0: r.removed_amt_dir }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking((w) => ({ ...w, [it.id]: false }));
    }
  };
  const small = (dim: boolean) => [amzStyles.small, { backgroundColor: theme.surface2, borderColor: theme.line, opacity: dim ? 0.5 : 1 }];

  return (
    <>
      <SectionTitle>{tx('settings.amzQueue.queue')}</SectionTitle>
      <Card>
        <View style={[styles.head, { borderBottomColor: theme.line }]}>
          <T mono size={10} w={700}>{busy ? tx('common.fetching') : tx('common.items', { v0: (queue ?? []).length })}</T>
          <View style={amzStyles.grow} />
          <Pressable onPress={() => void load()} disabled={busy} style={small(busy)}><T mono size={9} w={700}>{tx('settings.amzQueue.reload')}</T></Pressable>
        </View>
        {err && <T mono size={9} w={700} color={AMZ_RED} style={styles.note}>{`✗ ${err}`}</T>}
        {note && <T mono size={9} dim style={styles.note}>{`✓ ${note}`}</T>}
        {!err && queue?.length === 0 && !busy && <T mono size={9} dim style={styles.note}>{tx('settings.amzQueue.queueEmpty')}</T>}
        {(queue ?? []).map((it, i, a) => (
          <View key={it.id} style={[styles.row, i < a.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.line }]}>
            <T mono size={9} dim style={styles.id}>{`#${it.id}`}</T>
            <T mono size={9} w={700} style={styles.state}>{it.stateLabel || it.state || ''}</T>
            <T mono size={9} numberOfLines={1} style={amzStyles.grow}>{`${it.fileName || it.srcPath || ''}${it.serviceName ? ` / ${it.serviceName}` : ''}`}</T>
            <T mono size={9} dim>{it.profileName || ''}</T>
            <Pressable onPress={() => void act(it, 'Cancel')} disabled={!!working[it.id]} accessibilityHint="実行中の処理を中止する" style={small(!!working[it.id])}>
              <T mono size={9} w={700}>{tx('settings.amzQueue.abort')}</T>
            </Pressable>
            <Pressable disabled={!!working[it.id]} accessibilityHint="キューから削除する（作業フォルダも消す。元のファイルは消しません）"
              onPress={() => void act(it, 'RemoveItem', tx('settings.amzQueue.removeQueueWorkingFolder', { v0: it.id, v1: it.fileName || '' }))}
              style={small(!!working[it.id])}>
              <T mono size={9} w={700} color={AMZ_RED}>{tx('reservations.list.sheet.delete')}</T>
            </Pressable>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 13, borderBottomWidth: 1 },
  note: { paddingVertical: 9, paddingHorizontal: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 13 },
  id: { minWidth: 26 },
  state: { minWidth: 62 },
});
