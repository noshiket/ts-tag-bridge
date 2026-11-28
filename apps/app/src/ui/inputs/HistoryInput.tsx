import { inputHistoryCandidates, inputHistoryKey, parseInputHistory, pushInputHistory, type Api } from '@tstag/core';
import { useApi, useMe } from '@tstag/core/react';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { deviceStore } from '../../lib/device/deviceStore';
import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

// 欄の履歴はアカウント（サーバー）に持たせ、端末を替えても同じ候補を出す。
// 端末にも写しを置き（元の InputHistory と同じキー）、通信が無い時や読み込む前はそれを出す
let apiRef: Api | null = null;
/** 履歴を読んだ利用者（アカウントを替えたら読み直す） */
let userId: number | null = null;
/** サーバーから読んだ履歴（読む前は null） */
let server: Record<string, string[]> | null = null;
let loading = false;
const device = (k: string) => parseInputHistory(deviceStore.get(inputHistoryKey(k)));
const setDevice = (k: string, v: string[]) => deviceStore.set(inputHistoryKey(k), JSON.stringify(v));
/** この端末に前から残っていた履歴を、サーバーへ一度だけ混ぜ込んだ印（混ぜた後は端末はサーバーの写し） */
const mergedKey = (k: string) => `tstag_ihist_merged_${userId ?? 0}_${k}`;

function load(onDone: () => void) {
  if (server || loading || !apiRef) return;
  loading = true;
  apiRef.prefs.inputHistory()
    .then((h) => { server = h; onDone(); })
    .catch(() => { /* 通信が無ければ端末の写しで出す */ })
    .finally(() => { loading = false; });
}

/** サーバーを読んだ後、その欄を端末の写しと揃える（初めての欄は端末に残っていた分をサーバーへ混ぜる） */
async function sync(k: string) {
  if (!server || !apiRef) return;
  if (!deviceStore.get(mergedKey(k))) {
    const extra = device(k).filter((v) => !(server![k] ?? []).includes(v));
    if (extra.length) {
      try { server[k] = (await apiRef.prefs.changeInputHistory({ key: k, merge: extra })).items; } catch { return; }
    }
    deviceStore.set(mergedKey(k), '1');
  }
  setDevice(k, server[k] ?? []);
}

function change(k: string, body: { push?: string; remove?: string }, local: string[]) {
  setDevice(k, local);
  if (server) server[k] = local;
  apiRef?.prefs.changeInputHistory({ key: k, ...body })
    .then((r) => { if (server) server[k] = r.items; setDevice(k, r.items); })
    .catch(() => { /* 通信が無ければ端末にだけ残す */ });
}

export const InputHistory = {
  read: (k: string) => (server && deviceStore.get(mergedKey(k)) ? server[k] ?? [] : device(k)),
  /** 残す（検索した時など、決まった時に呼ぶ） */
  push: (k: string, v: string) => {
    const cur = InputHistory.read(k);
    const next = pushInputHistory(cur, v);
    if (next !== cur) change(k, { push: v }, next);
  },
  remove: (k: string, v: string) => change(k, { remove: v }, InputHistory.read(k).filter((x) => x !== v)),
};

/**
 * 履歴つきの入力欄（元の HistoryInput）。打っている間・入った時に、前に使った値を下に出す。
 * 押すとその値に、✕ で履歴から消す。欄を離れた時・決定した時に今の値を残す
 */
export function HistoryInput({ histKey, value, onChangeText, onSubmit, placeholder, style, wrapStyle }: {
  histKey: string;
  value: string;
  onChangeText: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  /** 欄と候補を包む枠（横並びで幅を伸ばす時の flex など） */
  wrapStyle?: StyleProp<ViewStyle>;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  apiRef = useApi();
  const me = useMe().data?.id ?? null;
  if (me !== userId) { userId = me; server = null; }
  const [hist, setHist] = useState<string[] | null>(null);
  const show = () => setHist(InputHistory.read(histKey));
  const open = () => {
    show();
    // サーバーの履歴を読んだら（読んである時はすぐ）、この欄を揃えて出し直す
    if (server) void sync(histKey).then(() => setHist((h) => (h ? InputHistory.read(histKey) : h)));
    else load(() => void sync(histKey).then(() => setHist((h) => (h ? InputHistory.read(histKey) : h))));
  };
  const items = hist ? inputHistoryCandidates(hist, value) : [];
  return (
    <View style={[styles.wrap, wrapStyle]}>
      <TextInput value={value} placeholder={placeholder} placeholderTextColor={theme.mute} autoCorrect={false} autoCapitalize="none"
        onChangeText={(v) => { open(); onChangeText(v); }}
        onFocus={open}
        // 候補を押す前に閉じないよう、少し待ってから閉じる（RN では押した時より先に欄が外れる）
        onBlur={() => { InputHistory.push(histKey, value); setTimeout(() => setHist(null), 200); }}
        onSubmitEditing={() => { InputHistory.push(histKey, value); setHist(null); onSubmit?.(); }}
        returnKeyType={onSubmit ? 'search' : 'done'}
        style={[styles.input, { color: theme.ink }, style]} />
      {items.length > 0 && (
        // iOS では欄の外（絶対配置ではみ出した所）を押しても届かず、候補を選べなかった。Web 以外は欄の下に並べる
        <View style={[styles.list, Platform.OS === 'web' && styles.floating, { backgroundColor: theme.surface, borderColor: theme.frame }]}>
          {items.map((v) => (
            <View key={v} style={[styles.row, { borderBottomColor: theme.line }]}>
              <Pressable style={styles.pick} onPress={() => { setHist(null); onChangeText(v); }}>
                <T size={12} numberOfLines={1}>{v}</T>
              </Pressable>
              <Pressable style={styles.del} accessibilityLabel={tx('ui.historyInput.removeHistory')}
                onPress={() => { InputHistory.remove(histKey, v); setHist(InputHistory.read(histKey)); }}>
                <T size={11} dim>✕</T>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 60 },
  input: { width: '100%', paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, fontSize: 12 },
  list: { marginTop: 3, borderWidth: 1.5, borderRadius: 9, maxHeight: 196, overflow: 'hidden' },
  floating: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  pick: { flex: 1, minWidth: 0, paddingVertical: 9, paddingHorizontal: 10 },
  del: { paddingVertical: 9, paddingHorizontal: 10 },
});
