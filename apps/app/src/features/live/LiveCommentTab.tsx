import type { LiveComment } from '@tstag/core';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View, type FlatList as FL } from 'react-native';

import { MuteSettings } from '../player/tabs/MuteSettings';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * ライブの「コメント」（元の live_right_panel.jsx の CommentBody のライブの方）: 実況の ON/OFF と ⚙（ミュート設定）、
 * 届いた順の一覧（いちばん下を見ている間は新しいものへ付いていく）、投稿
 */
export function LiveCommentTab({ comments, notice, supported, commentsOn, onToggleComments, onSend }: {
  comments: LiveComment[]; notice: string | null; supported: boolean; commentsOn: boolean;
  onToggleComments: () => void; onSend: (text: string) => Promise<{ ok: boolean }>;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [muteOpen, setMuteOpen] = useState(false);
  const [input, setInput] = useState('');
  const list = useRef<FL<LiveComment>>(null);
  const atBottom = useRef(true);
  const btn = (active: boolean) => [styles.btn, { backgroundColor: active ? accent.primary : 'transparent' }];
  const canSend = supported && commentsOn;
  const submit = async () => {
    const text = input.trim();
    if (!text || !canSend) return;
    const r = await onSend(text);
    if (r.ok) setInput('');
  };
  return (
    <View style={styles.wrap}>
      <View style={[styles.head, { borderBottomColor: theme.line }]}>
        <Pressable onPress={onToggleComments} style={btn(commentsOn)}>
          <T mono size={12} color={commentsOn ? '#fff' : theme.mute}>{tx('common.comments', { v0: commentsOn ? 'ON' : 'OFF' })}</T>
        </Pressable>
        <View style={styles.grow} />
        <Pressable onPress={() => setMuteOpen((o) => !o)} style={btn(muteOpen)}>
          <T mono size={12} color={muteOpen ? '#fff' : theme.mute}>⚙</T>
        </Pressable>
      </View>
      {muteOpen && <MuteSettings />}
      {!!notice && <T size={11} color="#FFA86A" style={[styles.notice, { backgroundColor: theme.surface2 }]}>{notice}</T>}
      <FlatList ref={list} data={comments} keyExtractor={(c, i) => `${c.id}-${i}`} style={styles.grow} contentContainerStyle={styles.list}
        onScroll={(e) => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 40; }}
        scrollEventThrottle={100}
        onContentSizeChange={() => { if (atBottom.current) list.current?.scrollToEnd({ animated: false }); }}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <T mono size={10} dim style={styles.time}>{item.time}</T>
            <T size={12} color={item.my_post ? '#10b981' : theme.ink} style={styles.grow}>{item.text}</T>
          </View>
        )} />
      <View style={[styles.inputRow, { borderTopColor: theme.line }]}>
        <TextInput value={input} onChangeText={setInput} onSubmitEditing={() => void submit()} editable={canSend}
          placeholder={tx(!commentsOn ? 'live.comment.off' : supported ? 'live.comment.input' : 'live.comment.unsupported')} placeholderTextColor={theme.mute}
          style={[styles.input, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
        <Pressable onPress={() => void submit()} disabled={!canSend} style={[styles.send, { backgroundColor: accent.primary, opacity: canSend ? 1 : 0.5 }]}>
          <T size={12} w={700} color="#fff">{tx('common.send')}</T>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  grow: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1 },
  btn: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  notice: { paddingVertical: 4, paddingHorizontal: 12 },
  list: { paddingVertical: 6, paddingHorizontal: 12, gap: 3 },
  item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  time: { paddingTop: 2 },
  inputRow: { flexDirection: 'row', gap: 6, padding: 8, borderTopWidth: 1 },
  input: { flex: 1, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, fontSize: 12, fontFamily: monoFamily[400] },
  send: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
});
