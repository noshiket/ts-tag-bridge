import { activeCommentIndex, formatDuration, type Comment } from '@tstag/core';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useBgRenderCount } from '../../../lib/lifecycle/bgRenders';
import { useT } from '../../../ui/i18n/I18n';

/** 行の高さ（固定。数千〜数万件あるので、見えている所だけ描く） */
const ROW_H = 22;

/**
 * 「コメント」タブ: 実況を全件並べ、再生位置のコメントを下端に来るよう追いかける（元の Web 版の CommentBody）。
 * 自分でスクロールすると追いかけるのをやめ、右下の ↓ で戻る。行を押すとそこへ飛ぶ
 */
export function CommentList({ comments, time, onSeek }: { comments: Comment[]; time: number; onSeek: (sec: number) => void }) {
  const { t: tx } = useT();
  useBgRenderCount('CommentList');
  const { accent } = useTheme();
  const listRef = useRef<FlatList<Comment>>(null);
  const [height, setHeight] = useState(0);
  const [follow, setFollow] = useState(true);
  const expectedRef = useRef(0);
  const active = useMemo(() => activeCommentIndex(comments, time), [comments, time]);
  // 押した時は最新の onSeek を呼ぶ（行を描き直さずに済むよう、渡す関数は変えない）
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const seek = useCallback((sec: number) => seekRef.current(sec), []);
  // 再生位置は 1 秒に 4 回届く。そのたびに見えている行を全部描き直すと iPhone/iPad では重く、
  // タイマー（操作の表示を消すなど）が何十秒も遅れた。描き直すのは今の行が替わった所だけにする
  const renderItem = useCallback(({ item, index }: { item: Comment; index: number }) => (
    <Row item={item} on={index === active} onSeek={seek} />
  ), [active, seek]);

  useEffect(() => {
    if (!follow || active < 0 || !height) return;
    const offset = Math.max(0, (active + 1) * ROW_H - height + 8);
    expectedRef.current = offset;
    listRef.current?.scrollToOffset({ offset, animated: false });
  }, [active, follow, height]);

  // 自分で動かした（追いかけている位置から大きくずれた）ら追いかけるのをやめる
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (follow && Math.abs(e.nativeEvent.contentOffset.y - expectedRef.current) > 24) setFollow(false);
  };

  if (!comments.length) return <T size={12} dim style={styles.empty}>{tx('player.commentList.noCommentsVideo')}</T>;
  return (
    <View style={styles.wrap} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <FlatList
        ref={listRef}
        data={comments}
        keyExtractor={(_c, i) => String(i)}
        getItemLayout={(_d, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
        onScroll={onScroll}
        scrollEventThrottle={64}
        windowSize={3}
        initialNumToRender={40}
        maxToRenderPerBatch={20}
        contentContainerStyle={styles.list}
        extraData={active}
        renderItem={renderItem}
      />
      {!follow && (
        <Pressable onPress={() => setFollow(true)} style={[styles.follow, { backgroundColor: accent.primary }]} accessibilityLabel={tx('player.commentList.backPlaybackPosition')}>
          <T size={18} color="#fff">↓</T>
        </Pressable>
      )}
    </View>
  );
}

const Row = memo(function Row({ item, on, onSeek }: { item: Comment; on: boolean; onSeek: (sec: number) => void }) {
  const { theme, accent } = useTheme();
  return (
    <Pressable onPress={() => onSeek(item.time)} style={styles.row}>
      <T mono size={10} dim style={styles.time}>{formatDuration(item.time) || '0:00'}</T>
      <T size={12} numberOfLines={1} w={on ? 700 : 400} color={on ? accent.primary : theme.ink} style={styles.text}>{item.text}</T>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  list: { paddingVertical: 6, paddingHorizontal: 10 },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { width: 40 },
  text: { flex: 1 },
  follow: {
    position: 'absolute', right: 12, bottom: 12, width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', boxShadow: '0px 2px 8px rgba(0,0,0,0.35)',
  },
  empty: { textAlign: 'center', padding: 40 },
});
