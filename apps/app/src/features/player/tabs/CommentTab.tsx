import { commentTrackLabel, type Comment } from '@tstag/core';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { CommentList } from './CommentList';
import { MuteSettings } from './MuteSettings';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 「コメント」タブ: 実況の ON/OFF と ⚙（ミュート設定）、その下に一覧（元の Web 版の CommentBody）。
 * 外から取り込んだコメント（追加のトラック）がある動画では、流すトラックを選べる（全て・標準・トラック名）
 */
export function CommentTab({ comments, time, commentsOn, onToggleComments, onSeek, tracks, track, onTrackChange }: {
  comments: Comment[] | undefined;
  time: number;
  commentsOn: boolean;
  onToggleComments: () => void;
  onSeek: (sec: number) => void;
  tracks?: string[] | null;
  track?: string;
  onTrackChange?: (t: string) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [muteOpen, setMuteOpen] = useState(false);
  const btn = (active: boolean) => [styles.btn, { backgroundColor: active ? accent.primary : 'transparent' }];
  return (
    <View style={styles.wrap}>
      <View style={[styles.head, { borderBottomColor: theme.line }]}>
        <Pressable onPress={onToggleComments} style={btn(commentsOn)} accessibilityLabel={tx('player.commentTab.comments')}>
          <T mono size={12} color={commentsOn ? '#fff' : theme.mute}>{tx('common.comments', { v0: commentsOn ? 'ON' : 'OFF' })}</T>
        </Pressable>
        <View style={styles.grow} />
        <Pressable onPress={() => setMuteOpen((o) => !o)} style={btn(muteOpen)} accessibilityLabel={tx('player.commentTab.muteSettings')}>
          <T mono size={12} color={muteOpen ? '#fff' : theme.mute}>⚙</T>
        </Pressable>
      </View>
      {tracks && tracks.length > 1 && onTrackChange && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tracks}
          style={[styles.trackBar, { borderBottomColor: theme.line }]} accessibilityLabel={tx('player.commentTab.commentTracks')}>
          {tracks.map((t) => (
            <Pressable key={t} onPress={() => onTrackChange(t)} style={[styles.track, { borderColor: theme.line },
              t === track && { backgroundColor: accent.primary, borderColor: accent.primary }]}>
              <T mono size={11} numberOfLines={1} color={t === track ? '#fff' : theme.mute}>{commentTrackLabel(t)}</T>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {muteOpen && <MuteSettings />}
      {comments ? <CommentList comments={comments} time={time} onSeek={onSeek} />
        : <T size={12} dim style={styles.loading}>{tx('common.loading')}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1 },
  btn: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  grow: { flex: 1 },
  trackBar: { flexGrow: 0, borderBottomWidth: 1 },
  tracks: { gap: 6, paddingVertical: 6, paddingHorizontal: 12 },
  track: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, maxWidth: 220 },
  loading: { textAlign: 'center', padding: 40 },
});
