import { transferButton, transferStatus, type RecordingDetail } from '@tstag/core';
import { useApi, useNodes } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { Sheet } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';
import { HeadScanSheet } from './HeadScanSheet';

const RED = oklch(0.6, 0.22, 25);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 録画詳細の「…」（元の detail_rec.jsx）: EIT スキャン・CM 解析のやり直し・別のサーバーへ転送（と進み具合）・
 * 解析の中止/再開・エンコードのキューの取り消し・局ロゴの取得・DB の列の表示。
 * 結果は onMessage で見出しの横に出す（時間のかかるものは投げっぱなし。元と同じ）
 */
export function RecMoreSheet({ r, node, open, onClose, onMessage, onChanged }: {
  r: RecordingDetail;
  node: string | null;
  open: boolean;
  onClose: () => void;
  onMessage: (m: string, ms?: number) => void;
  onChanged: () => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const nodes = useNodes();
  const [busy, setBusy] = useState<string | null>(null);
  // DB の列: 読み込み中 / 失敗 / 値
  const [cols, setCols] = useState<null | { s: 'loading' } | { s: 'error'; msg: string } | { s: 'ok'; cols: Record<string, unknown> }>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [headOpen, setHeadOpen] = useState(false);
  const id = r.db_rec_id!;
  const run = async (key: string, start: string, fn: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(key); onClose(); onMessage(start);
    try {
      const done = await fn();
      if (done) onMessage(done, 3000);
      onChanged();
    } catch (e) {
      const m = errText(e);
      onMessage(m.includes('409') ? tx('recresult.rec.alreadyRunning', { what: tx(key === 'cm' ? 'recresult.rec.cm' : 'recresult.rec.transfer') }) : tx('common.failed', { v0: m }));
    } finally {
      setBusy(null);
    }
  };
  const peers = (nodes.data?.nodes ?? []).filter((n) => n.name && n.name !== node);
  const t = r.transfer_state as (RecordingDetail['transfer_state'] & { error?: string; updated_at?: string }) | null;
  const ts = t ? transferStatus(t) : null;
  const Btn = ({ label, onPress, danger, disabled, dim }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean; dim?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, { borderColor: danger ? RED : theme.frame, opacity: dim ? 0.6 : 1 }]}>
      <T mono size={13} w={700} color={danger ? RED : theme.ink}>{label}</T>
    </Pressable>
  );
  return (
    <>
      <Sheet open={open} onClose={onClose} title={tx('common.other')}>
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.scroll} contentContainerStyle={styles.list}>
          <Btn label={busy === 'eit' ? tx('recresult.recMoreSheet.scanning') : tx('recresult.recMoreSheet.scanScanEit')} disabled={!!busy}
            onPress={() => void run('eit', tx('recresult.recMoreSheet.scanning'), async () => { await api.recordings.scanEit(id, node); return tx('recresult.recMoreSheet.scanDone'); })} />
          <Btn label={tx('recresult.headScan.button')} disabled={!!busy} onPress={() => { onClose(); setHeadOpen(true); }} />
          {/* CM 解析が落ちると登録の解析では作られないので、ここからやり直せる。進み具合は分割の画面で見る */}
          <Btn label={busy === 'cm' ? tx('recresult.recMoreSheet.startingCmAnalysis') : tx('recresult.recMoreSheet.rerunCmAnalysisCm')} disabled={!!busy}
            onPress={() => void run('cm', tx('recresult.recMoreSheet.cmAnalysisStarted'), async () => {
              const { t: tx } = useT();
              const res = await api.recordings.cmAnalysis(id, node);
              if (res?.started === false) return tx('recresult.recMoreSheet.couldntStartCmAnalysis');
            })} />
          {peers.map((n) => {
            const b = transferButton(n.name, t, busy === `tr:${n.name}` ? n.name : null);
            return (
              <Btn key={n.name} label={b.label} danger={b.failed} disabled={!!busy || b.busy} dim={b.busy}
                onPress={() => void run(`tr:${n.name}`, tx('recresult.rec.transferStarted', { name: n.name }), () => api.recordings.transfer(id, n.name, node).then(() => undefined))} />
            );
          })}
          {(r.state === 'scanning' || r.state === 'pending') && (
            <Btn label={busy === 'cancel' ? tx('recresult.recMoreSheet.requestingAbort') : tx('recresult.recMoreSheet.abortAnalysisCancelScan')} danger disabled={!!busy}
              onPress={() => void run('cancel', tx('recresult.recMoreSheet.requestedAbort'), () => api.recordings.cancelScan(id, node).then(() => undefined))} />
          )}
          {ts && t && (
            <View style={[styles.transfer, { borderColor: ts.bad ? RED : theme.frame, backgroundColor: theme.surface }]}>
              <T mono size={11} w={800} color={ts.bad ? RED : theme.ink}>{ts.text}</T>
              {!ts.bad && !ts.done && (
                <View style={[styles.track, { backgroundColor: theme.surface2 }]}><View style={{ width: `${ts.pct}%`, height: '100%', backgroundColor: accent.primary }} /></View>
              )}
              {!!t.error && <T mono size={10} color={oklch(0.5, 0.22, 25)} style={styles.mt4}>{t.error}</T>}
              <T mono size={9} dim style={styles.mt4}>
                {String(t.updated_at || '').slice(0, 19).replace('T', ' ')}{ts.done ? ` · ${tx('recresult.rec.transferNote', { node: t.node })}` : ''}
              </T>
            </View>
          )}
          {['queued', 'encoding', 'error', 'encode_error'].includes(r.state ?? '') && (
            <Btn label={busy === 'cancelEnc' ? tx('recresult.recMoreSheet.cancelling') : tx('recresult.recMoreSheet.cancelEncodeQueueCancel')} danger disabled={!!busy}
              onPress={() => void run('cancelEnc', tx('recresult.recMoreSheet.cancellingEncodeQueue'), async () =>
                tx('recresult.recMoreSheet.cancelledEncodeQueue', { v0: (await api.recordings.cancelEncode(id, node)).cancelled?.length ?? 0 }))} />
          )}
          {r.scan_cancelled && (
            <Btn label={busy === 'rescan' ? tx('recresult.recMoreSheet.requesting') : tx('recresult.recMoreSheet.resumeAnalysisRescan')} disabled={!!busy}
              onPress={() => void run('rescan', tx('recresult.recMoreSheet.analysisResumed'), () => api.recordings.rescan(id, node).then(() => undefined))} />
          )}
          <Btn label={busy === 'logo' ? tx('common.fetching') : tx('recresult.recMoreSheet.getStationLogoExtract')} disabled={!!busy}
            onPress={() => void run('logo', tx('recresult.recMoreSheet.gettingLogo'), async () => {
              const res = await api.recordings.extractLogo(id, node);
              const n = res.saved?.length ?? 0;
              const s = res.skipped?.length ?? 0;
              return n > 0 ? tx('common.savedSkipped', { v0: n, v1: s, v2: '' }) : tx('recresult.rec.noChange', { n: s });
            })} />
          <Btn label={tx('recresult.recMoreSheet.showDbColumnsDb')} onPress={() => {
            onClose(); setExpanded(new Set()); setCols({ s: 'loading' });
            api.recordings.columns(id, node).then((c) => setCols({ s: 'ok', cols: c }), (e) => setCols({ s: 'error', msg: errText(e) }));
          }} />
        </ScrollView>
      </Sheet>

      <HeadScanSheet id={id} node={node} open={headOpen} onClose={() => setHeadOpen(false)} onMessage={onMessage} onChanged={onChanged} />

      <Sheet open={cols != null} onClose={() => setCols(null)} title={`DB COLUMNS — recordings.id=${id}`}>
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.colsScroll}>
          {cols?.s === 'loading' && <T mono size={11} dim>{tx('common.loading')}</T>}
          {cols?.s === 'error' && <T mono size={11} color={RED}>{cols.msg}</T>}
          {cols?.s === 'ok' && Object.entries(cols.cols).map(([k, v]) => {
              const open1 = expanded.has(k);
              const str = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
              return (
                <Pressable key={k} onPress={() => setExpanded((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                  style={[styles.col, { borderBottomColor: theme.line, backgroundColor: open1 ? theme.surface2 : 'transparent' }]}>
                  <T mono size={9} w={700} color={open1 ? theme.ink : theme.mute} style={styles.colKey}>{k}</T>
                  <T mono size={10} color={str === '' ? theme.mute : theme.ink} numberOfLines={open1 ? undefined : 1} style={styles.grow}>{str === '' ? '∅ NULL' : str}</T>
                </Pressable>
              );
            })}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 520 },
  list: { gap: 8 },
  btn: { padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
  transfer: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1.5 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  mt4: { marginTop: 4 },
  colsScroll: { maxHeight: 560 },
  col: { flexDirection: 'row', gap: 8, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 6, borderBottomWidth: 1, alignItems: 'flex-start' },
  colKey: { width: 150 },
  grow: { flex: 1 },
});
