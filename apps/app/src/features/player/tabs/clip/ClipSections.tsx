import { chapterTime, type PlayerTabAddon } from '@tstag/core';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ClipBtn, clipStyles as cs, useClipBox } from './clipParts';
import type { ClipJob } from './useClipJob';
import type { FrameStepper } from './useFrameStepper';
import { Select } from '../../../../ui/inputs/Select';
import { T } from '../../../../ui/parts/T';
import { monoFamily } from '../../../../ui/theme/theme';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/** 現在位置（コマの番号）・コマ送り/戻し・止まっている時はそのコマの静止画（画像そのままの縦横比） */
export function ClipFrameBox({ f, playing }: { f: FrameStepper; playing: boolean }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const box = useClipBox();
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <View style={box}>
      <T mono size={9} dim>{tx('player.clipSections.currentPosition')}</T>
      <T mono size={15} w={800}>{chapterTime(f.shownT)}</T>
      <T mono size={9} dim>
        {f.times == null ? tx('player.clipSections.checkingFrameTable') : f.has ? tx('player.clipSections.frameSnapsRealFrames', { v0: f.curIdx, v1: f.times.length }) : tx('player.clipSections.noFrameTableCuts')}
      </T>
      <View style={cs.row}>
        <ClipBtn onPress={() => f.step(-1)}>{tx('player.clipSections.frameBack')}</ClipBtn>
        <ClipBtn onPress={() => f.step(1)}>{tx('player.clipSections.frameForward')}</ClipBtn>
      </View>
      {!playing && f.imgSrc && (
        <View style={styles.mt7}>
          <Image source={f.imgSrc}
            onLoad={(e) => { f.setImgLoading(false); if (e.source.width && e.source.height) setRatio(e.source.width / e.source.height); }} onError={() => f.setImgLoading(false)} contentFit="contain"
            style={[styles.frame, { aspectRatio: ratio, borderColor: theme.line, opacity: f.imgLoading ? 0.45 : 1 }]} />
          {(f.imgLoading || f.imgT !== f.shownT) && <View style={styles.over}><T mono size={10} color="#fff">{tx('common.loading2')}</T></View>}
        </View>
      )}
    </View>
  );
}

/** IN / OUT（今のコマに置く・そこへ移る・外す）と長さ */
export function ClipRangeBox({ f, c, seek }: { f: FrameStepper; c: ClipJob; seek: (sec: number) => void }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const box = useClipBox();
  return (
    <View style={box}>
      <View style={[cs.row, cs.mb6]}>
        <ClipBtn fill onPress={() => c.setInT(f.shownT)}>{tx('player.clipSections.set')}</ClipBtn>
        <ClipBtn fill onPress={() => c.setOutT(f.shownT)}>{tx('player.clipSections.set2')}</ClipBtn>
      </View>
      {([['IN', c.inT, c.setInT], ['OUT', c.outT, c.setOutT]] as const).map(([label, val, set]) => (
        <View key={label} style={styles.line}>
          <T mono size={9} dim style={styles.lab}>{label}</T>
          <T mono size={12} dim={val == null} style={cs.grow}>
            {val == null ? '未設定' : `${chapterTime(f.snap(val))}${f.has ? `  (第${f.frameOf(val)}フレーム)` : ''}`}
          </T>
          {val != null && <ClipBtn small onPress={() => seek(f.snap(val))}>{tx('common.move')}</ClipBtn>}
          {val != null && <ClipBtn small onPress={() => set(null)}>×</ClipBtn>}
        </View>
      ))}
      {c.inT != null && c.outT != null && (
        <T mono size={10} color={c.outT > c.inT ? theme.mute : '#ef4444'} style={cs.mt4}>
          {c.outT > c.inT ? `長さ ${(f.snap(c.outT) - f.snap(c.inT)).toFixed(3)} 秒` : tx('player.clipSections.mustAfter')}
        </T>
      )}
    </View>
  );
}

/** 切り抜きのアドオンの項目（params から組む。アドオン側を差し替えれば項目も変わる） */
export function ClipParamsBox({ addon, params, setParams }: {
  addon: PlayerTabAddon; params: Record<string, unknown>; setParams: (f: (x: Record<string, unknown>) => Record<string, unknown>) => void;
}) {
  const { theme } = useTheme();
  const box = useClipBox();
  return (
    <View style={box}>
      {(addon.params ?? []).map((p) => (
        <View key={p.key} style={cs.mb6}>
          <T mono size={9} dim>{p.label}</T>
          {p.type === 'select' ? (
            <Select label={p.label} value={String(params[p.key] ?? '')} onChange={(v) => setParams((x) => ({ ...x, [p.key]: v }))}
              options={(p.options ?? []).map((o) => (typeof o === 'object' && o
                ? { value: String((o as { value: unknown }).value), label: String((o as { label?: string; value: unknown }).label || (o as { value: unknown }).value) }
                : { value: String(o), label: String(o) }))} />
          ) : p.type === 'bool' ? (
            <ClipBtn on={!!params[p.key]} onPress={() => setParams((x) => ({ ...x, [p.key]: !x[p.key] }))}>{params[p.key] ? 'ON' : 'OFF'}</ClipBtn>
          ) : (
            <TextInput value={params[p.key] == null ? '' : String(params[p.key])} keyboardType={p.type === 'number' ? 'numeric' : 'default'}
              onChangeText={(v) => setParams((x) => ({ ...x, [p.key]: p.type === 'number' ? Number(v) : v }))}
              style={[styles.field, { borderColor: theme.line, backgroundColor: theme.bg, color: theme.ink }]} />
          )}
          {!!p.description && <T size={8} dim>{p.description}</T>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mt7: { marginTop: 7 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  lab: { width: 30 },
  frame: { width: '100%', borderRadius: 6, borderWidth: 1, backgroundColor: '#000' },
  over: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  field: { paddingVertical: 5, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[800] },
});
