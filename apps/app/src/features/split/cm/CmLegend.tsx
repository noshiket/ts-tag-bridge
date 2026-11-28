import { cmAddonItems, cmRanges, fmtDur, type CmJob, type CmMarkDecl, type CmResult } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { CM_ORANGE, MARK, markColor } from './cmColors';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** CM解析を後から走らせるボタン。again=やり直し。1本数分・4コアを使い切るので走っている間は押せない */
export function CmAnalysisButton({ job, onStart, again }: { job: CmJob | null; onStart: () => void; again?: boolean }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const running = job?.state === 'queued' || job?.state === 'running';
  const label = running ? (job!.state === 'queued' ? `順番待ち${job!.queue_position ? `（${job!.queue_position}番目）` : ''}…` : 'CM解析中…（数分かかります）')
    : again ? 'CM解析をやり直す' : tx('split.cmLegend.analyzeCms');
  return (
    <>
      <Pressable onPress={onStart} disabled={running} style={[styles.smallBtn, { backgroundColor: running ? theme.surface2 : theme.surface, borderColor: theme.frame }]}>
        <T mono size={9} w={800}>{label}</T>
      </Pressable>
      {job?.state === 'error' && !!job.error && <T mono size={9} color="#ef4444">{job.error}</T>}
    </>
  );
}

/** タイムラインの下の凡例と、解析のやり直し・アドオンの掛け直し。解析が無ければその旨と前回の失敗の理由 */
export function CmLegend({ cm, total, job, error, onStart, onRerunAddons, addonBusy, addonMsg, decls, addonLabels }: {
  cm: CmResult | null; total: number; job: CmJob | null; error: string | null; onStart: () => void; onRerunAddons: () => void; addonBusy: boolean; addonMsg: string;
  /** CM解析のアドオンが名乗る印の出し方と、アドオンの名前（掛け直しのボタン） */
  decls: CmMarkDecl[]; addonLabels: string[];
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  if (!cm) {
    return (
      <View style={[styles.legend, styles.wrap]}>
        <T mono size={9} dim>{tx('split.cmLegend.noCmAnalysisCm')}</T>
        <CmAnalysisButton job={job} onStart={onStart} />
        {/* 落ちた理由。これが無いと、やり直せば直るのか分からない */}
        {!!error && <T mono size={9} color="#ef4444" style={styles.full}>{tx('split.cmLegend.lastFailure', { v0: error })}</T>}
      </View>
    );
  }
  // アドオンが書き足した印（名乗った分だけ。中身が無いものは出さない）
  const shown = decls.map((d) => ({ d, n: cmAddonItems(cm, d.key).length })).filter((x) => x.n > 0);
  // ▼の説明はアドオンの短い名前ごとに1つ
  const jumpNames = [...new Map(shown.filter((x) => x.d.jump).map((x) => [x.d.short ?? x.d.label, markColor(x.d)])).entries()];
  return (
    <View style={[styles.legend, styles.wrap]}>
      <View style={styles.row}><View style={[styles.sw, { width: 14, height: 6, backgroundColor: CM_ORANGE, borderColor: theme.frame }]} /><T mono size={9} dim>{tx('split.cmLegend.cmCandidates', { v0: cmRanges(cm, total).length })}</T></View>
      <View style={styles.row}><View style={{ width: 1, height: 8, backgroundColor: theme.ink, opacity: 0.55 }} /><T mono size={9} dim>{tx('split.cmLegend.silentSceneChanges', { v0: (cm.scenes ?? []).length })}</T></View>
      {shown.map(({ d, n }) => (
        <View key={d.key} style={styles.row}>
          <View style={d.kind === 'range' ? { width: 14, height: 3, backgroundColor: markColor(d) } : { width: 2, height: 8, backgroundColor: markColor(d) }} />
          <T mono size={9} dim>{tx('common.labelCount', { v0: d.label, v1: n })}</T>
        </View>
      ))}
      <T mono size={9} dim>
        {'▼ '}<T mono size={9} w={800} color={MARK.mute}>{tx('common.silent')}</T>
        {jumpNames.map(([name, color]) => <T key={name} mono size={9} w={800} color={color}>{` ${name}`}</T>)}
        <T mono size={9} w={800} color={MARK.manual}> {tx('split.cmLegend.manual')}</T>
      </T>
      <T mono size={9} dim>{tx('split.cmLegend.keepTotal', { v0: fmtDur(cm.kept_sec ?? 0), v1: fmtDur(cm.total_sec ?? 0) })}</T>
      {!!cm.logos?.length && <T mono size={9} dim>{tx('split.cmLegend.logos', { v0: cm.logos.join(', ') })}</T>}
      <T mono size={9} dim style={styles.faint}>{tx('split.cmLegend.referenceNotAppliedSplitting')}</T>
      <CmAnalysisButton job={job} onStart={onStart} again />
      {/* CM解析のアドオンだけ掛け直す（有効なアドオンが無ければ出さない） */}
      {addonLabels.length > 0 && (
        <Pressable onPress={onRerunAddons} disabled={addonBusy} style={[styles.smallBtn, { backgroundColor: addonBusy ? theme.surface2 : theme.surface, borderColor: theme.frame }]}>
          <T mono size={9} w={800}>{addonBusy ? tx('split.cmLegend.reRunningAddOns') : tx('split.cmLegend.reRunAddOns')}</T>
        </Pressable>
      )}
      {addonLabels.length > 0 && <T mono size={8} dim style={styles.faint}>{addonLabels.join(' / ')}</T>}
      {!!addonMsg && <T mono size={9} dim>{addonMsg}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  full: { width: '100%' },
  faint: { opacity: 0.7 },
  legend: { marginTop: 4 },
  sw: { borderWidth: 1 },
  smallBtn: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
});
