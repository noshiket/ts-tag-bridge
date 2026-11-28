import { StyleSheet, View } from 'react-native';

import { EditorCard, Label9, editorStyles as es } from '../common/editorUi';
import { TextSegmenter } from '../common/TextSegmenter';
import type { PatternEditorState } from '../state/usePatternEditor';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * パターンビルダー: 番組名・番組説明・詳細情報の文字に {$N} のグループを付けてパターンを組む。
 * 既存パターンの編集・登録ではパターンそのもの（グループ）は変えない。変えられるのは新規の時だけ
 */
export function PatternBuilder({ ed }: { ed: PatternEditorState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const { ctx, mode } = ed;
  if (!ctx) return null;
  const readOnly = !!mode && mode.type !== 'new_pattern';
  const used = new Set([...ed.titleSegs, ...ed.descSegs, ...ed.extSegs].filter((s) => s.group).map((s) => s.group!));
  return (
    <View style={es.section}>
      <SectionTitle>{tx('patterns.patternBuilder.patternBuilder')}</SectionTitle>
      <EditorCard color={theme.ink}>
        <View style={es.mb12}>
          <Label9>{tx('patterns.patternBuilder.title')}</Label9>
          {readOnly && !!mode?.analyzer?.pattern && <T mono size={9} dim style={[styles.patBox, { backgroundColor: theme.surface2 }]}>{mode.analyzer.pattern}</T>}
          <TextSegmenter text={ed.normalizedTitle} segments={ed.titleSegs} setSegments={ed.setTitleSegs} readOnly={readOnly}
            onFirstGroup={() => ed.firstGroup('$title')} usedGroupNums={used} />
        </View>
        {!!ctx.description && (
          <View style={es.mb12}>
            <Label9>{tx('patterns.patternBuilder.description')}</Label9>
            <TextSegmenter text={ctx.description} segments={ed.descSegs} setSegments={ed.setDescSegs} readOnly={readOnly}
              onFirstGroup={() => ed.firstGroup('$description')} usedGroupNums={used} />
          </View>
        )}
        {!!ctx.extended_info && (
          <View style={es.mb12}>
            <Label9>{tx('patterns.patternBuilder.details')}</Label9>
            <TextSegmenter text={ctx.extended_info} segments={ed.extSegs} setSegments={ed.setExtSegs} readOnly={readOnly}
              onFirstGroup={() => ed.firstGroup('$extended_info')} usedGroupNums={used} />
          </View>
        )}
      </EditorCard>
    </View>
  );
}

const styles = StyleSheet.create({
  patBox: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, marginBottom: 6 },
});
