import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Label9, editorStyles as es } from '../common/editorUi';
import type { PatternEditorState } from '../state/usePatternEditor';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 登録・編集の欄の上側: 登録済みタイトル（タイトル編集）、AND条件（新規の時だけ ON にできる。既存は読むだけ）、
 * 新規の SWITCH 変数と ELSE / タイトルの切り替え、タイトル登録の SWITCH 値
 */
export function EditPanelFields({ ed, modeColor }: { ed: PatternEditorState; modeColor: string }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const mode = ed.mode!;
  const onColor = modeColor === theme.ink ? theme.onInk : '#fff';
  const input = [es.input, { borderColor: theme.frame, backgroundColor: theme.surface2, color: theme.ink }];
  const p2 = ed.patternsBySource[ed.np2Source];
  return (
    <>
      {mode.type === 'edit_list' && (
        <View style={es.mb10}>
          <Label9>{tx('patterns.editPanelFields.registeredTitlesEditTitle')}</Label9>
          <T mono size={11} style={[es.valBox, { backgroundColor: theme.surface2 }]}>{mode.matchedTitle}</T>
        </View>
      )}
      <View style={es.mb10}>
        <View style={[es.rowC, (mode.analyzer?.pattern2 || ed.np2Enabled) ? es.mb8 : null]}>
          <T mono size={9} dim>{tx('patterns.editPanelFields.condition2')}</T>
          {mode.type === 'new_pattern' && (
            <Pressable onPress={() => ed.setNp2Enabled((p) => !p)} style={[styles.toggle, { borderColor: ed.np2Enabled ? modeColor : theme.line, backgroundColor: ed.np2Enabled ? modeColor : 'transparent' }]}>
              <T mono size={8} w={800} color={ed.np2Enabled ? onColor : theme.mute}>{ed.np2Enabled ? 'ON' : 'OFF'}</T>
            </Pressable>
          )}
        </View>
        {mode.type !== 'new_pattern' ? <T mono size={11} dim style={[es.valBox, { backgroundColor: theme.surface2 }]}>{mode.analyzer.pattern2 || tx('common.none')}</T> : ed.np2Enabled && (
          <View>
            <View style={[es.rowC, es.mb6]}>
              {([['$description', 'DESCRIPTION'], ['$extended_info', 'EXTENDED INFO']] as const).map(([src, l]) => (
                <Pressable key={src} onPress={() => ed.setNp2Source(src)} style={[styles.seg, { backgroundColor: ed.np2Source === src ? modeColor : theme.surface2 }]}>
                  <T mono size={8} w={800} color={ed.np2Source === src ? onColor : theme.mute}>{l}</T>
                </Pressable>
              ))}
            </View>
            <T mono size={11} color={p2 ? theme.ink : theme.mute} style={[es.valBox, { backgroundColor: theme.surface2 }]}>{p2 || tx('patterns.editPanelFields.noSegments')}</T>
          </View>
        )}
      </View>

      {mode.type === 'new_pattern' && (
        <View style={es.mb10}>
          <View style={[es.rowC, es.mb8]}>
            <T mono size={9} dim>SWITCH VARIABLE</T>
            <TextInput value={ed.npSwitch} onChangeText={ed.setNpSwitch} style={[...input, styles.sw]} />
            <T mono size={9} dim>{`= {$${ed.npSwitch}}`}</T>
            <View style={es.grow} />
            <View style={[styles.segWrap, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              {([['else', 'ELSE'], ['title', tx('library.musicSort.title')]] as const).map(([k, l]) => (
                <Pressable key={k} onPress={() => ed.setNpMode(k)} style={[styles.seg, ed.npMode === k && { backgroundColor: modeColor }]}>
                  <T mono size={9} w={800} color={ed.npMode === k ? theme.onInk : theme.mute}>{l}</T>
                </Pressable>
              ))}
            </View>
          </View>
          {ed.npMode === 'title' && (
            <View style={styles.mt8}>
              <Label9>{tx('patterns.editPanelFields.valueRegisterTitle')}</Label9>
              <TextInput value={ed.npTitleStr} onChangeText={ed.setNpTitleStr} style={[...input, styles.big]} />
            </View>
          )}
        </View>
      )}
      {mode.type === 'add_title' && (
        <View style={es.mb10}>
          <Label9>{tx('patterns.editPanelFields.valueRegisterTitle')}</Label9>
          <TextInput value={ed.atStr} onChangeText={ed.setAtStr} style={[...input, styles.big]} />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 5, borderWidth: 1 },
  segWrap: { flexDirection: 'row', borderRadius: 8, padding: 2, borderWidth: 1, gap: 2 },
  seg: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 },
  sw: { width: 44, paddingVertical: 5, paddingHorizontal: 8, fontSize: 11, textAlign: 'center' },
  big: { paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10, fontSize: 12 },
  mt8: { marginTop: 8 },
});
