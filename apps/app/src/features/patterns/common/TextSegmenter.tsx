import { assignGroup, freeGroups, removeGroup, type Segment } from '@tstag/core';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { ANCHOR, SELECTING, groupColor } from './colors';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 題名の文字を選んで {$N} にする（元の parse.jsx の TextSegmenter）。
 * 先頭の文字 → 末尾の文字の順にタップし、出てきた番号を選ぶ。グループをタップすると外れる
 */
export function TextSegmenter({ text, segments, setSegments, onFirstGroup, readOnly = false, usedGroupNums }: {
  text: string; segments: Segment[]; setSegments: (s: Segment[]) => void;
  onFirstGroup?: () => void; readOnly?: boolean; usedGroupNums?: Set<number>;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const fired = useRef(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [popup, setPopup] = useState<{ start: number; end: number } | null>(null);
  const [last, setLast] = useState<{ start: number; end: number; group: number } | null>(null);

  const tapChar = (i: number) => {
    if (anchor === null) { setAnchor(i); setPopup(null); setLast(null); return; }
    setPopup({ start: Math.min(anchor, i), end: Math.max(anchor, i) + 1 });
    setAnchor(null);
  };
  const assign = (n: number) => {
    if (!popup) return;
    setSegments(assignGroup(segments, popup.start, popup.end, n));
    setLast({ ...popup, group: n });
    setPopup(null);
    // 最初の割り当てで、どの文（題名・説明）から作っているかを親へ知らせる
    if (!fired.current && onFirstGroup) { fired.current = true; onFirstGroup(); }
  };
  const cancel = () => { setAnchor(null); setPopup(null); };

  const chars: ReactNode[] = [];
  let abs = 0;
  segments.forEach((seg, si) => {
    if (!seg.text) return;
    if (seg.group) {
      const g = seg.group;
      chars.push(
        <Text key={`g${si}`} onPress={readOnly ? undefined : () => { setSegments(removeGroup(segments, si)); setLast(null); setPopup(null); }}
          style={[styles.group, { backgroundColor: groupColor(g) }]}>
          {` ${seg.text}`}<Text style={styles.sup}>{`$${g} `}</Text>
        </Text>,
      );
      abs += seg.text.length;
      return;
    }
    [...seg.text].forEach((ch) => {
      const i = abs++;
      const inSel = popup && i >= popup.start && i < popup.end;
      const inLast = last && i >= last.start && i < last.end;
      const style = anchor === i ? { backgroundColor: ANCHOR, color: '#fff' }
        : inSel ? { backgroundColor: SELECTING, color: theme.isDark ? '#fff' : '#1a1414' }
        : inLast ? { backgroundColor: `${groupColor(last.group)}44`, textDecorationLine: 'underline' as const, textDecorationColor: groupColor(last.group) }
        : null;
      chars.push(<Text key={i} onPress={readOnly ? undefined : () => tapChar(i)} style={style}>{ch}</Text>);
    });
  });

  return (
    <View>
      {!readOnly && (anchor !== null
        ? <T mono size={9} w={700} color={ANCHOR} style={styles.hint}>{tx('patterns.textSegmenter.tapLastCharacterSet')}</T>
        : <T mono size={9} dim style={styles.hint}>{tx('patterns.textSegmenter.tapFirstCharacterStart')}</T>)}
      <Pressable disabled={readOnly} onPress={cancel}
        style={[styles.box, { backgroundColor: theme.surface2, borderColor: readOnly ? theme.line : anchor !== null ? ANCHOR : theme.frame, opacity: readOnly ? 0.75 : 1 }]}>
        <Text style={[styles.text, { color: theme.ink }]}>{chars}</Text>
      </Pressable>
      {!readOnly && popup && (
        <View style={[styles.popup, { backgroundColor: theme.ink }]}>
          <T mono size={9} color={theme.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)'}>{tx('patterns.textSegmenter.assignGroup')}</T>
          {freeGroups(usedGroupNums ?? new Set()).map((n) => (
            <Pressable key={n} onPress={() => assign(n)} style={[styles.gBtn, { backgroundColor: groupColor(n) }]}>
              <T mono size={13} w={800} color="#fff">{`$${n}`}</T>
            </Pressable>
          ))}
          <Pressable onPress={cancel} style={[styles.gBtn, styles.ml4, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)' }]}>
            <T size={12} w={800} color={theme.onInk}>×</T>
          </Pressable>
        </View>
      )}
      {segments.some((s) => s.group) && (
        <View style={[styles.out, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <T mono size={9} dim>{tx('patterns.textSegmenter.generatedPattern')}</T>
          <Text style={[styles.pat, { color: theme.ink }]}>
            {segments.map((s, i) => (s.group ? <Text key={i} style={{ color: groupColor(s.group) }}>{`{$${s.group}}`}</Text> : <Text key={i}>{s.text}</Text>))}
          </Text>
          {!readOnly && (
            <Pressable onPress={() => { setSegments([{ text, group: null, key: 0 }]); setAnchor(null); setPopup(null); setLast(null); }}
              style={[styles.reset, { borderColor: theme.line }]}>
              <T mono size={9} dim>{tx('patterns.textSegmenter.reset')}</T>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 6, letterSpacing: 0.5 },
  box: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5 },
  text: { fontSize: 15, fontWeight: '700', lineHeight: 30 },
  group: { color: '#fff', fontFamily: monoFamily[700] },
  sup: { fontSize: 9, fontWeight: '900' },
  popup: { marginTop: 8, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  gBtn: { width: 32, height: 32, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  ml4: { marginLeft: 4 },
  out: { marginTop: 8, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  pat: { fontFamily: monoFamily[700], fontSize: 12, fontWeight: '700' },
  reset: { marginTop: 6, alignSelf: 'flex-start', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1 },
});
