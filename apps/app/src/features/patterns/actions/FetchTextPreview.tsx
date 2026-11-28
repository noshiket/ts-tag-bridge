import { segPattern, type Action, type Segment, type FetchTextCtx, type AddonSearchHit } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { actionStyles as st } from './actionUi';
import { TextSegmenter } from '../common/TextSegmenter';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 文字を取ってくるアクション（副題の取得など。アドオンが名乗る）の予行検索と副題パターン: 照合タイトルで検索し、選んだ副題の文字に {$N} を付けて副題パターンを作る
 * （手では書かせない）。nested は副題に当てる入れ子のアクション（作り直しても残す）
 */
export function FetchTextPreview({ addon, action, nested, onChange, fetchCtx }: { addon: string; action: Action; nested: Action[]; onChange: (a: Action) => void; fetchCtx: FetchTextCtx }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [results, setResults] = useState<AddonSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [subIdx, setSubIdx] = useState<number | null>(null);
  const [subSegs, setSubSegs] = useState<Segment[]>([]);

  // 照合タイトルをそのまま使う。{$N} はビルダーで選んだ文字、{$folder} 等は同じアクション列の値、$var は context。
  // 解けない参照が残る時だけ番組の題名で代える
  const searchTitle = (() => {
    const tf = String(action.textField || '$title');
    if (tf.startsWith('$')) return String(fetchCtx.context[tf.slice(1)] ?? '');
    const filled = tf.replace(/\{\$([^{}]+)\}/g, (m, k: string) => {
      const v = /^\d+$/.test(k) ? fetchCtx.groups[k] : (fetchCtx.fields?.[k] ?? fetchCtx.context[k]);
      return v == null || v === '' ? m : String(v);
    });
    return filled.includes('{$') ? String(fetchCtx.context.title ?? '') : filled;
  })();
  const search = () => {
    if (!searchTitle || loading) return;
    setLoading(true); setResults(null); setSubIdx(null);
    api.patterns.addonSearch(addon, searchTitle, fetchCtx.sid).then(setResults).catch(() => setResults([])).finally(() => setLoading(false));
  };
  const onSubSegs = (segs: Segment[]) => { setSubSegs(segs); onChange({ ...action, pattern: segPattern(segs), analyze: nested }); };
  const off = loading || !searchTitle;

  return (
    <>
      <View style={[st.row, st.center, st.mb6]}>
        <Pressable onPress={search} disabled={off} style={[styles.search, { backgroundColor: off ? theme.surface : accent.primary }]}>
          <T mono size={9} w={700} color={off ? theme.mute : '#fff'}>{loading ? tx('patterns.fetchTextPreview.searching') : tx('patterns.fetchTextPreview.dryRunSearch')}</T>
        </Pressable>
        <T mono size={8} dim numberOfLines={1} style={st.grow}>{`「${searchTitle || '照合タイトル未設定'}」${fetchCtx.sid ? ` · sid=${fetchCtx.sid}` : ''}`}</T>
      </View>
      {subIdx === null && !!action.pattern && (
        <View style={[styles.curPat, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          <T mono size={8} dim>{tx('patterns.fetchTextPreview.currentSubtitlePattern')}</T>
          <T mono size={10}>{String(action.pattern)}</T>
        </View>
      )}
      {results !== null && (
        <ScrollView automaticallyAdjustKeyboardInsets style={[styles.results, { borderColor: theme.line }]} nestedScrollEnabled>
          {results.length === 0 ? <T mono size={9} dim style={styles.pad8}>{tx('common.noMatches')}</T> : results.slice(0, 30).map((r, i) => (
            <View key={i} style={[styles.hit, { borderBottomColor: theme.line, backgroundColor: subIdx === i ? `${accent.primary}18` : 'transparent' }]}>
              <View style={st.grow}>
                <T mono size={10}>{r.subtitle || tx('patterns.fetchTextPreview.noSubtitle')}</T>
                <T mono size={8} dim>{`${r.series_title ?? ''} · ${r.broadcast_label ?? ''} · ${r.broadcaster ?? ''}`}</T>
              </View>
              <Pressable onPress={() => { setSubIdx(i); setSubSegs([{ text: r.subtitle || '', group: null, key: 0 }]); onChange({ ...action, pattern: '' }); }}
                style={[styles.pick, { backgroundColor: subIdx === i ? accent.primary : theme.surface, borderColor: accent.primary }]}>
                <T mono size={8} w={700} color={subIdx === i ? '#fff' : accent.primary}>{subIdx === i ? tx('patterns.fetchTextPreview.selected') : tx('patterns.fetchTextPreview.createPattern')}</T>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      {subIdx !== null && subSegs.length > 0 && (
        <View style={st.mb6}>
          <T mono size={9} dim style={st.mb3}>{tx('patterns.fetchTextPreview.subtitlePatternBuilderSelect')}</T>
          {/* 親のビルダーで使った番号と、副題の中で使った番号は選ばせない */}
          <TextSegmenter text={subSegs.map((s) => s.text).join('')} segments={subSegs} setSegments={onSubSegs}
            usedGroupNums={new Set([...fetchCtx.usedGroupNums, ...subSegs.filter((s) => s.group).map((s) => s.group!)])} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  search: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  curPat: { marginBottom: 6, paddingVertical: 5, paddingHorizontal: 8, borderWidth: 1, borderRadius: 7 },
  results: { maxHeight: 200, marginBottom: 6, borderWidth: 1, borderRadius: 7 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 1 },
  pick: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 5, borderWidth: 1 },
  pad8: { padding: 8 },
});
