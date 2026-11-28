import { actionFieldValues } from '@tstag/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionRow } from '../actions/ActionRow';
import { AddActionButton } from '../actions/AddActionButton';
import { SC } from '../common/colors';
import { EditorCard, editorStyles as es } from '../common/editorUi';
import { EditPanelFields } from './EditPanelFields';
import { TestResultPanel } from './TestResultPanel';
import type { PatternEditorState } from '../state/usePatternEditor';
import { Trash } from '../../../ui/parts/Icons';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { errorBox } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 新規登録・else編集・タイトル登録・タイトル編集の欄（アクションの並び、テスト、保存・削除）。開いた時はここまで画面を動かす */
export function EditPanel({ ed }: { ed: PatternEditorState }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const { mode } = ed;
  if (!mode) return null;
  const modeColor = mode.type === 'add_title' ? accent.primary : mode.type === 'new_pattern' ? theme.ink : SC.matched;
  const modeLabel = mode.type === 'new_pattern' ? '新規パターン登録 / NEW PATTERN' : mode.type === 'edit_else' ? tx('patterns.editPanel.editElse')
    : mode.type === 'add_title' ? 'タイトル登録 / ADD TITLE' : tx('patterns.editPanel.editTitle');
  const modeShort = mode.type === 'new_pattern' ? (ed.npMode === 'title' ? 'タイトル登録' : tx('patterns.editPanel.registerElse')) : mode.type === 'edit_else' ? 'ELSE編集' : mode.type === 'add_title' ? 'タイトル登録' : tx('patterns.editPanel.editTitle2');
  const canSaveNew = ed.hasGroups && (ed.npMode === 'else' || !!ed.npTitleStr.trim());
  const editing = mode.type === 'edit_else' || mode.type === 'edit_list';
  return (
    <View style={es.section} onLayout={(e) => ed.panelScroll.onLayout(e.nativeEvent.layout.y)}>
      <SectionTitle>{modeLabel}</SectionTitle>
      {!!ed.saveWarn && <T mono size={10} color={errorBox.text} style={[es.warn, { backgroundColor: '#FFE3DE', borderColor: '#FF6853' }]}>{ed.saveWarn}</T>}
      <EditorCard color={modeColor} w={2}>
        <EditPanelFields ed={ed} modeColor={modeColor} />

        <T mono size={9} dim style={es.mb6}>{tx('patterns.editPanel.analyzeActions', { v0: modeShort })}</T>
        {ed.activeActions.map((a, i) => (
          <ActionRow key={i} action={a}
            onChange={ed.withActionDefaults(a, (v) => ed.setActiveActions((p) => p.map((x, j) => (j === i ? v : x))))}
            onRemove={() => ed.setActiveActions((p) => p.filter((_, j) => j !== i))}
            activeTextSource={ed.activeTextSource} patternsBySource={ed.patternsBySource}
            fetchCtx={{ ...ed.fetchCtx, fields: actionFieldValues(ed.activeActions, ed.fetchCtx.groups) }} />
        ))}
        <AddActionButton onPress={() => ed.setActiveActions((p) => [...p, { type: 'setStr', field: '', str: '' }])}>{tx('patterns.editPanel.addAction')}</AddActionButton>
        <Pressable onPress={ed.runTest} style={[es.outline, { borderColor: accent.primary }]}><T mono size={10} color={accent.primary}>{tx('common.testRun')}</T></Pressable>
        <TestResultPanel result={ed.testResult} k="active" />

        <View style={[es.rowC, styles.mt4]}>
          {mode.type === 'new_pattern' && (
            <Pressable onPress={() => void ed.saveNew()} disabled={!canSaveNew}
              style={[styles.action, { backgroundColor: ed.npSaved ? SC.matched : modeColor, opacity: canSaveNew ? 1 : 0.5 }]}>
              <T size={12} w={800} color={ed.npSaved ? '#fff' : theme.onInk}>{ed.npSaved ? tx('patterns.editPanel.added') : ed.npMode === 'title' ? tx('patterns.editPanel.registerTitle') : tx('patterns.editPanel.addNewPatternsException')}</T>
            </Pressable>
          )}
          {editing && (
            <Pressable onPress={() => void ed.saveEdit()} style={[styles.action, { backgroundColor: SC.matched }]}><T size={12} w={800} color="#fff">{tx('common.save')}</T></Pressable>
          )}
          {mode.type === 'add_title' && (
            <Pressable onPress={() => void ed.confirmAddTitle()} disabled={!ed.atStr.trim()} style={[styles.action, { backgroundColor: accent.primary, opacity: ed.atStr.trim() ? 1 : 0.5 }]}>
              <T size={12} w={800} color="#fff">{tx('common.register')}</T>
            </Pressable>
          )}
          <Pressable onPress={ed.resetToNormal} style={[styles.action, styles.cancel, { borderColor: theme.frame }]}><T size={12} w={700}>{tx('common.cancel')}</T></Pressable>
          {editing && (
            <Pressable onPress={() => void ed.deleteEntry()} style={[styles.del, { backgroundColor: errorBox.bg, borderColor: SC.nomatch }]}>
              <Trash s={12} c="#B00000" /><T size={12} w={800} color="#B00000">{tx('reservations.list.sheet.delete')}</T>
            </Pressable>
          )}
        </View>
      </EditorCard>
    </View>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, padding: 11, borderRadius: 11, alignItems: 'center' },
  cancel: { backgroundColor: 'transparent', borderWidth: 1.5 },
  del: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1.5 },
  mt4: { marginTop: 4 },
});
