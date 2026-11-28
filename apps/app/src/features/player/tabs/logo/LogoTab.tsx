import type { PlayerTabAddon } from '@tstag/core';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { LogoCornerPad } from './LogoCornerPad';
import { LogoBtn, LogoNote, logoStyles as ls } from './logoParts';
import { LogoProgress } from './LogoProgress';
import { useLogoJob } from './useLogoJob';
import { logoRectStore } from '../logoRectStore';
import { T } from '../../../../ui/parts/T';
import { monoFamily } from '../../../../ui/theme/theme';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/**
 * 再生画面の「ロゴ」（元の stream_right_tab_logo.jsx）: 録画（TS）に Amatsukaze のロゴ解析を走らせる（ロゴ生成のアドオン amz_logo）。
 * 止めた映像の上で範囲を囲み、元の TS の画素へ直して渡す。スマホは映像が小さいので、角を1つずつ動かすパッドも出す。
 * 仕事は useLogoJob、パッドは LogoCornerPad、進みと結果は LogoProgress
 */
export function LogoTab({ addon, dbRecId, node }: { addon: PlayerTabAddon; dbRecId: number; node: string | null }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const isPC = useWindowDimensions().width >= 900;
  // source='recording' のアドオンは複数ある（CM解析など）ので名前で選ぶ
  const [params, setParams] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (addon) setParams(Object.fromEntries((addon.params ?? []).filter((p) => p.default !== undefined).map((p) => [p.key, p.default])));
  }, [addon?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const j = useLogoJob(addon.name, dbRecId, node, params);
  const { px, size, running } = j;

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.pad}>
      <T mono size={10} dim style={ls.lh}>
        {tx('player.logoTab.pauseSceneLogo')}<T mono size={10} w={700}>{tx('player.logoTab.dragDirectlyVideo')}</T>{tx('player.logoTab.encloseLogoGrabCorners')}
        {!isPC ? '\n下のパッドを指でなぞると、選んだ角だけを細かく動かせます。' : ''}
      </T>

      <View style={[styles.box, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
        {px && size ? (
          <>
            <T mono size={12}>{`X ${px.x} / Y ${px.y} — ${px.width} × ${px.height}`}</T>
            <LogoNote>{tx('player.logoTab.specifiedSourcePixels', { v0: size.w, v1: size.h })}</LogoNote>
          </>
        ) : <LogoNote>{size ? tx('player.logoTab.noRangeYetDrag') : tx('player.logoTab.waitingVideoLoad')}</LogoNote>}
      </View>

      {!isPC && <LogoCornerPad running={running} />}
      {px && !running && <View style={[ls.row, ls.mt8]}><LogoBtn onPress={() => logoRectStore.set(null)}>{tx('player.logoTab.clearRange')}</LogoBtn></View>}

      <View style={[ls.row, styles.wrap, ls.mt8]}>
        {(addon.params ?? []).map((p) => (
          <View key={p.key} style={ls.row}>
            <LogoNote>{p.label.split(tx('player.logoTab.openParen'))[0]}</LogoNote>
            <TextInput value={params[p.key] == null ? '' : String(params[p.key])} keyboardType="numeric"
              onChangeText={(v) => setParams((x) => ({ ...x, [p.key]: Number(v) }))}
              style={[styles.num, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
          </View>
        ))}
      </View>

      <View style={[ls.row, styles.wrap, ls.mt10]}>
        <LogoBtn on disabled={running || !px} onPress={j.start}>{running ? tx('player.logoTab.analyzing') : tx('player.logoTab.createLogo')}</LogoBtn>
        {!!j.msg && <T mono size={10}>{j.msg}</T>}
      </View>

      <LogoProgress j={j} wantFrames={Number(params.max_frames) || 1000} />

      {!!j.job?.log?.length && (
        <ScrollView automaticallyAdjustKeyboardInsets style={[styles.log, { backgroundColor: theme.surface2 }]} nestedScrollEnabled>
          <T mono size={9} dim>{j.job.log.join('\n')}</T>
        </ScrollView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingVertical: 10, paddingHorizontal: 12 },
  box: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  wrap: { flexWrap: 'wrap', gap: 10 },
  num: { width: 70, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
  log: { marginTop: 10, maxHeight: 160, padding: 8, borderRadius: 6 },
});
