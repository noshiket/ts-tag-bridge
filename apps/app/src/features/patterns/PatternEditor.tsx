import type { PatternCtx } from '@tstag/core';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ProgramContextCard } from './sections/ProgramContextCard';
import { editorStyles as es } from './common/editorUi';
import { MatchedPatterns } from './sections/MatchedPatterns';
import { EditPanel } from './sections/EditPanel';
import { PatternBuilder } from './sections/PatternBuilder';
import { ShoboiPanel } from './shoboi/ShoboiPanel';
import { usePatternEditor } from './state/usePatternEditor';
import { Queue } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { errorBox } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';

/**
 * パターンの登録・編集（元の pattern.jsx の PatternScreen と stream_right_tab_pattern.jsx の PatternTab）。
 * この番組の題名に当たるパターン（完全マッチ・追加候補）を見て、足りなければその場で登録・編集する。登録先は番組の局（SID）のパターン。
 * screen はパターン画面の書き方: アクションはサーバーの定義で組み、保存前に無いグループの参照を止め、
 * 組めない AND条件は元を引き継ぎ、追加候補をその場で消せる。再生画面のタブは元の定義で組む（元のタブと同じ）。
 * 状態と操作は usePatternEditor、上から CONTEXT → マッチ → ビルダー → 登録・編集の欄
 */
export function PatternEditor({ ctx, screen, topBar }: {
  ctx: PatternCtx | null;
  screen?: boolean;
  /** 画面の上端（しょぼいカレンダーの開け閉めボタンを渡す）。無ければ一覧の中に置く（再生画面のタブ） */
  topBar?: (shoboiButton: ReactNode) => ReactNode;
}) {
  const { theme, accent } = useTheme();
  const ed = usePatternEditor(ctx, screen);
  const [shoboiOpen, setShoboiOpen] = useState(false);

  const shoboiButton = (
    <Pressable onPress={() => setShoboiOpen((o) => !o)}
      style={[styles.shoboiBtn, { backgroundColor: shoboiOpen ? accent.primary : theme.surface, borderColor: shoboiOpen ? accent.primary : theme.frame, boxShadow: shadow(theme, 2) }]}>
      {shoboiOpen ? <T size={13} w={800} color="#fff">×</T> : <Queue s={15} c={theme.ink} />}
    </Pressable>
  );
  const shoboi = shoboiOpen && <ShoboiPanel ctx={ctx} onClose={() => setShoboiOpen(false)} g1Text={ed.titleSegs.find((s) => s.group === 1)?.text || ''} onApply={ed.shoboiApply} />;

  return (
    <View style={[es.grow, { backgroundColor: theme.bg }]}>
      {/* パターン画面は上端としょぼいカレンダーを一覧の外に置く（元は sticky） */}
      {topBar && <>{topBar(shoboiButton)}{shoboi}</>}
      <ScrollView automaticallyAdjustKeyboardInsets ref={ed.scroll} style={es.grow} contentContainerStyle={styles.bottom}>
        {!!ed.peerSyncMsg && <T mono size={10} color={errorBox.text} style={[styles.peer, { backgroundColor: errorBox.bg }]}>{ed.peerSyncMsg}</T>}
        {!topBar && (
          <>
            <View style={[styles.shoboiBar, { borderBottomColor: theme.line }]}>{shoboiButton}</View>
            {shoboi}
          </>
        )}
        <View style={es.section}><ProgramContextCard ctx={ctx} tpContext={ed.data.tpContext} screen={screen} /></View>
        <MatchedPatterns ed={ed} />
        <PatternBuilder ed={ed} />
        <EditPanel ed={ed} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: { paddingBottom: 60 },
  peer: { marginTop: 8, marginHorizontal: 14, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  shoboiBar: { paddingVertical: 6, paddingHorizontal: 14, alignItems: 'flex-end', borderBottomWidth: 1 },
  shoboiBtn: { width: 32, height: 32, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
