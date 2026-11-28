import { tNow } from '../../../ui/i18n/I18n';
import type { MsgKey } from '@tstag/core';
import type { LiveComment, OnairEvent, liveProgress } from '@tstag/core';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CaptureTab, type CaptureOptions, type CaptureResult } from '../../player/tabs/CaptureTab';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { LiveCommentTab } from '../LiveCommentTab';
import { LiveProgramTab } from '../LiveProgramTab';

const TABS = { program: 'common.program', comment: 'common.comments2', capture: 'library.tab.captures' } as const satisfies Record<string, MsgKey>;
export type LiveTab = keyof typeof TABS;

/** 映像の横（PC・横持ち）か下（縦持ち）のパネル: 番組情報・コメント一覧と送信・キャプチャ */
export function LiveSidePanel({ tab, setTab, style, cur, next, pv, node, comments, notice, supported, commentsOn, onToggleComments, onSend, onCapture }: {
  tab: LiveTab; setTab: (t: LiveTab) => void; style: StyleProp<ViewStyle>;
  cur: OnairEvent | null; next: OnairEvent | null; pv: ReturnType<typeof liveProgress>; node: string | null;
  comments: LiveComment[]; notice: string | null; supported: boolean; commentsOn: boolean;
  onToggleComments: () => void; onSend: (text: string) => Promise<{ ok: boolean }>; onCapture: (o: CaptureOptions) => Promise<CaptureResult>;
}) {
  const { theme, accent } = useTheme();
  return (
    <View style={[{ backgroundColor: theme.bg }, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.noGrow}>
        {(Object.keys(TABS) as LiveTab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, { borderColor: theme.line, backgroundColor: tab === t ? accent.primary : 'transparent' }]}>
            <T size={11} w={700} color={tab === t ? '#fff' : theme.mute}>{tNow(TABS[t])}</T>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.flex}>
        {tab === 'program' && <LiveProgramTab cur={cur} next={next} pv={pv} />}
        {tab === 'comment' && (
          <LiveCommentTab comments={comments} notice={notice} supported={supported} commentsOn={commentsOn} onToggleComments={onToggleComments} onSend={onSend} />
        )}
        {tab === 'capture' && <CaptureTab captures={undefined} albumId={null} node={node} onCapture={onCapture} onPlayAt={() => {}} canCapture />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noGrow: { flexGrow: 0 },
  tabs: { gap: 8, padding: 12 },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
});
