import { CHAPTER_PRESETS, chapterTime, parseChapterTxt, sortMarks, type ChapterMark, type PlayerTabAddon } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 再生画面の「チャプター」（元の stream_right_tab_chapter.jsx）: 再生位置に印を足して名前を付け、
 * チャプター編集のアドオン（player_ui: 'chapters' を名乗るもの）で tag.json の chapter_txt へ保存する。シークバーへは開き直すと出る
 */
export function ChapterTab({ addon, videoId, node, now, onSeek }: { addon: PlayerTabAddon; videoId: number; node: string | null; now: () => number; onSeek: (sec: number) => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const tag = useQuery({ queryKey: ['videoTag', node ?? '', videoId], queryFn: () => api.videoActions.tag(videoId, node) });
  const [list, setList] = useState<ChapterMark[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (tag.data) { setList(parseChapterTxt(tag.data.tag?.chapter_txt as string | undefined)); setDirty(false); } else if (tag.error) setList([]);
  }, [tag.data, tag.error]);

  const edit = (fn: (l: ChapterMark[]) => ChapterMark[]) => { setList((l) => sortMarks(fn(l ?? []))); setDirty(true); setMsg(null); };
  const at = (i: number, patch: (x: ChapterMark) => ChapterMark) => edit((l) => l.map((x, j) => (j === i ? patch(x) : x)));
  const save = async () => {
    if (!list) return;
    setBusy(true);
    setMsg(null);
    try {
      const { job_id } = await api.videoActions.runAddon(videoId, addon.name, { chapters: JSON.stringify(list) }, node);
      const tick = async (): Promise<void> => {
        const j = await api.videoActions.addonJob(job_id, node);
        if (j.state === 'running') { await new Promise((r) => setTimeout(r, 800)); return tick(); }
        setBusy(false);
        if (j.error) { setMsg(j.error); return; }
        setDirty(false);
        const n = (j.result as { chapters?: number } | undefined)?.chapters ?? list.length;
        setMsg(tx('player.chapterTab.savedReopenSeeThem', { v0: n }));
      };
      await tick();
    } catch (e) { setBusy(false); setMsg(e instanceof Error ? e.message : tx('common.couldntSave2')); }
  };

  if (list === null) return <T mono size={10} dim style={styles.box}>{tx('common.loading2')}</T>;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.box}>
      <T mono size={10} dim style={styles.lh}>
        再生位置に印を足して名前を付けます。空の名前でも印としては効きます。保存すると tag.json の chapter_txt を書き換えます。Amatsukaze が付ける名前は英字がブロック、'A90Sec' の数字はその区間の長さ(秒)です。
      </T>
      <View style={styles.btns}>
        <Btn on onPress={() => edit((l) => [...l, { sec: now(), name: '' }])}>{tx('player.chapterTab.addCurrentPosition')}</Btn>
        <Btn on={dirty && !busy} onPress={() => void save()}>{busy ? tx('common.saving2') : tx('common.save')}</Btn>
      </View>
      {!!msg && <T mono size={10} color={accent.primary} style={styles.mb6}>{msg}</T>}
      {list.length === 0 && <T mono size={10} dim>{tx('player.chapterTab.noChaptersYet')}</T>}
      {list.map((ch, i) => (
        <View key={i} style={[styles.row, { backgroundColor: theme.surface2 }]}>
          <View style={styles.line}>
            <Small dark onPress={() => onSeek(ch.sec)}>{chapterTime(ch.sec)}</Small>
            <Small onPress={() => at(i, (x) => ({ ...x, sec: Math.max(0, x.sec - 0.5) }))}>−0.5s</Small>
            <Small onPress={() => at(i, (x) => ({ ...x, sec: x.sec + 0.5 }))}>+0.5s</Small>
            <Small onPress={() => at(i, (x) => ({ ...x, sec: now() }))}>←PH</Small>
            <View style={styles.grow} />
            <Small mute onPress={() => edit((l) => l.filter((_, j) => j !== i))}>×</Small>
          </View>
          <View style={[styles.line, styles.wrap]}>
            <TextInput value={ch.name} placeholder={tx('player.chapterTab.chapterNameOptional')} placeholderTextColor={theme.mute} onChangeText={(v) => at(i, (x) => ({ ...x, name: v }))}
              style={[styles.field, { backgroundColor: theme.surface, color: theme.ink, borderColor: theme.line }]} />
            {CHAPTER_PRESETS.map((nm) => <Small key={nm} dark={ch.name === nm} onPress={() => at(i, (x) => ({ ...x, name: nm }))}>{nm}</Small>)}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Btn({ children, on, onPress }: { children: string; on: boolean; onPress: () => void }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!on} style={[styles.btn, { backgroundColor: on ? accent.primary : 'transparent', borderColor: on ? 'transparent' : theme.line, opacity: on ? 1 : 0.6 }]}>
      <T mono size={11} w={700} color={on ? '#fff' : theme.ink}>{children}</T>
    </Pressable>
  );
}

function Small({ children, onPress, dark, mute }: { children: ReactNode; onPress: () => void; dark?: boolean; mute?: boolean }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.small, { backgroundColor: dark ? theme.ink : theme.surface2, borderColor: theme.line }]}>
      <T mono size={9} w={800} color={dark ? theme.onInk : mute ? theme.mute : theme.ink}>{children}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: 10, paddingHorizontal: 12 },
  lh: { lineHeight: 17 },
  btns: { flexDirection: 'row', gap: 6, marginVertical: 10 },
  btn: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 8, borderWidth: 1 },
  mb6: { marginBottom: 6 },
  row: { gap: 4, paddingVertical: 6, paddingHorizontal: 7, borderRadius: 6, marginBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  wrap: { flexWrap: 'wrap', gap: 4 },
  grow: { flex: 1 },
  small: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
  field: { flex: 1, minWidth: 80, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1, fontSize: 10, fontFamily: monoFamily[800] },
});
