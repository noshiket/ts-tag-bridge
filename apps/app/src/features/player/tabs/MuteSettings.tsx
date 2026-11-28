import type { MsgKey } from '@tstag/core';
import type { MuteSettings as Settings } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { updateCommentSettings, useCommentSettings } from '../../../lib/playback/commentSettings';
import { Slider } from '../../../ui/inputs/Slider';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

type NumKey = 'comment_opacity' | 'comment_font_scale' | 'comment_max_onscreen';
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

// 元の Web 版の MuteSettings と同じ並び
const SLIDERS: [NumKey, MsgKey, number, number, number, (v: number) => string][] = [
  ['comment_opacity', 'player.muteSettings.opacity', 0.1, 1.0, 0.05, (v) => `${Math.round(v * 100)}%`],
  ['comment_font_scale', 'player.muteSettings.textSize', 0.5, 2.0, 0.1, (v) => `×${v.toFixed(1)}`],
  ['comment_max_onscreen', 'player.muteSettings.maxScreen', 20, 400, 20, (v) => `${v}`],
];
const TOGGLES: [BoolKey, MsgKey][] = [
  ['mute_fixed_comments', 'player.muteSettings.muteFixedTopComments'],
  ['mute_colored_comments', 'player.muteSettings.muteColoredComments'],
  ['mute_big_size_comments', 'player.muteSettings.muteBigComments'],
  ['mute_vulgar_comments', 'player.muteSettings.muteExplicitContent'],
  ['mute_abusive_discriminatory_prejudiced_comments', 'player.muteSettings.muteNegativeContent'],
  ['mute_consecutive_same_characters_comments', 'player.muteSettings.mute8RepeatedCharacters'],
  ['mute_comment_keywords_normalize_alphanumeric_width_case', 'player.muteSettings.normalizeFullWidthLetters'],
];

/** 実況のミュートと弾幕の表示の設定（コメントタブの ⚙）。変えるとすぐ弾幕に効き、端末に残る */
export function MuteSettings() {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const s = useCommentSettings();
  const [kw, setKw] = useState('');
  const addKeyword = () => {
    const t = kw.trim();
    if (!t) return;
    updateCommentSettings({ muted_comment_keywords: [...s.muted_comment_keywords, { match: 'partial', pattern: t }] });
    setKw('');
  };
  return (
    <View style={[styles.panel, { borderBottomColor: theme.line }]}>
      {SLIDERS.map(([key, label, min, max, step, fmt]) => (
        <View key={key} style={styles.row}>
          <T size={11} style={styles.label}>{tx(label)}</T>
          <Slider label={tx(label)} value={s[key]} min={min} max={max} step={step} onChange={(v) => updateCommentSettings({ [key]: v })} />
          <T mono size={11} style={styles.value}>{fmt(s[key])}</T>
        </View>
      ))}
      <View style={[styles.rule, { backgroundColor: theme.line }]} />
      {TOGGLES.map(([key, label]) => (
        <Pressable key={key} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked: s[key] }}
          onPress={() => updateCommentSettings({ [key]: !s[key] })}>
          <View style={[styles.box, { borderColor: theme.mute }, s[key] && { backgroundColor: '#10b981', borderColor: '#10b981' }]}>
            {s[key] && <T size={10} w={800} color="#fff">✓</T>}
          </View>
          <T size={11}>{tx(label)}</T>
        </Pressable>
      ))}
      <View style={styles.kwRow}>
        <TextInput value={kw} onChangeText={setKw} onSubmitEditing={addKeyword} placeholder={tx('player.muteSettings.mutedKeywordsPartialMatch')}
          placeholderTextColor={theme.mute}
          style={[styles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
        <Pressable onPress={addKeyword} style={styles.add}><T size={11} w={700} color="#fff">{tx('library.musicSort.added')}</T></Pressable>
      </View>
      {s.muted_comment_keywords.length > 0 && (
        <View style={styles.chips}>
          {s.muted_comment_keywords.map((k, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: theme.surface2 }]}>
              <T size={11}>{k.pattern}</T>
              <Pressable accessibilityLabel={tx('player.muteSettings.remove', { v0: k.pattern })} hitSlop={6}
                onPress={() => updateCommentSettings({ muted_comment_keywords: s.muted_comment_keywords.filter((_x, j) => j !== i) })}>
                <T size={11} dim>×</T>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { width: 110 },
  value: { width: 44, textAlign: 'right' },
  rule: { height: 1, marginVertical: 4 },
  box: { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  kwRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, fontSize: 11 },
  add: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#10b981', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6 },
});
