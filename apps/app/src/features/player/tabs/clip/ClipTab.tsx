import type { PlayerTabAddon } from '@tstag/core';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { clipStyles as cs, useClipBox } from './clipParts';
import { ClipFrameBox, ClipParamsBox, ClipRangeBox } from './ClipSections';
import { useClipJob } from './useClipJob';
import { useFrameStepper } from './useFrameStepper';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 再生画面の「切り抜き」（元の stream_right_tab_clip.jsx）: IN/OUT を決めて切り抜きの部品（player_ui: 'clip_range'）を名乗るアドオンを動かす。
 * 項目はアドオンの params から組むので、アドオン側を差し替えれば項目も変わる。フレーム表があれば実際のコマへ吸着させる。
 * コマ送りは useFrameStepper、範囲と仕事は useClipJob
 */
export function ClipTab({ addon, videoId, node, time, playing, pause, seek }: {
  /** 切り抜きのアドオン（player_ui: 'clip_range' を名乗るもの） */
  addon: PlayerTabAddon;
  videoId: number; node: string | null; time: number; playing: boolean; pause: () => void; seek: (sec: number) => void;
}) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  const box = useClipBox();
  // player_tab は複数ある（ロゴ生成など）。切り抜きのアドオンを名前で選ぶ
  const [params, setParams] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (addon) setParams(Object.fromEntries((addon.params ?? []).filter((p) => p.default !== undefined).map((p) => [p.key, p.default])));
  }, [addon?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = useFrameStepper(videoId, node, time, playing, pause, seek);
  const c = useClipJob(videoId, node);
  const { job, result } = c;
  const mb = `${((result?.size ?? 0) / 1024 / 1024).toFixed(1)} MB`;

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.wrap}>
      <ClipFrameBox f={f} playing={playing} />
      <ClipRangeBox f={f} c={c} seek={seek} />
      <ClipParamsBox addon={addon} params={params} setParams={setParams} />

      <Pressable onPress={() => void c.run(addon.name, { ...params, start: f.snap(c.inT!), end: f.snap(c.outT!) })} disabled={!c.canRun}
        style={[cs.big, { backgroundColor: accent.primary, opacity: c.canRun ? 1 : 0.45 }]}>
        <T mono size={12} w={700} color="#fff">{c.busy ? tx('player.clipTab.cutting') : tx('player.clipTab.cutSave')}</T>
      </Pressable>
      {c.busy && <View style={[box, cs.mt8]}><T mono size={10} dim>{tx('player.clipTab.processingServerContinuesIf')}</T></View>}
      {!!job?.log?.length && (
        <ScrollView automaticallyAdjustKeyboardInsets style={[box, cs.mt8, styles.log]} nestedScrollEnabled>
          {job.log.map((l, i) => <T key={i} mono size={9} dim>{l}</T>)}
        </ScrollView>
      )}
      {job?.state === 'error' && <T mono size={10} color="#ef4444" style={styles.err}>{job.error ?? ''}</T>}
      {c.dlUrl && result && (Platform.OS === 'web' ? (
        <>
          <Pressable onPress={() => void c.download()} style={[cs.big, cs.mt8, { backgroundColor: accent.secondary || accent.primary }]}>
            <T mono size={12} w={700} color="#fff">{tx('player.clipTab.download', { v0: mb })}</T>
          </Pressable>
          <T size={9} dim style={[cs.mt4, styles.lh]}>{tx('player.clipTab.downloadingDeletesTempFile')}</T>
        </>
      ) : (
        // iOS: 端末へ落としてから共有シートで渡す（「ファイルに保存」「写真に保存」など）
        <>
          <Pressable onPress={() => void c.saveNative()} disabled={c.saving} style={[cs.big, cs.mt8, { backgroundColor: accent.secondary || accent.primary, opacity: c.saving ? 0.6 : 1 }]}>
            <T mono size={12} w={700} color="#fff">{c.saving ? tx('common.downloading') : tx('player.clipTab.saveDevice', { v0: mb })}</T>
          </Pressable>
          <T size={9} dim style={[cs.mt4, styles.lh]}>{tx('player.clipTab.savingDeletesTempFile')}</T>
        </>
      ))}
      {!!c.msg && <T mono size={10} color="#ef4444" style={cs.mt8}>{c.msg}</T>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  lh: { lineHeight: 17 },
  wrap: { paddingVertical: 10, paddingHorizontal: 12 },
  log: { maxHeight: 120 },
  err: { marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.12)' },
});
