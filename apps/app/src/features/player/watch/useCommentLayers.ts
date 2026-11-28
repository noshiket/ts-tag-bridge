import { ALL_COMMENT_TRACKS, commentTrackNames, selectCommentTrack, unmutedComments, type StreamMeta, type StreamRef } from '@tstag/core';
import { useCaptions, useComments } from '@tstag/core/react';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useCommentSettings } from '../../../lib/playback/commentSettings';

/**
 * 映像に重ねる実況と字幕: 流すトラック（既定は全て）、ミュートを除いた流す分、弾幕の見た目、字幕、
 * iOS の焼き込みの小窓へ渡す形、Web の下の帯（ミニプレイヤー）にも同じものを出す
 */
export function useCommentLayers(target: StreamRef, node: string | null, meta: StreamMeta | undefined, audioOnly: boolean) {
  // 実況を流す（元の「コ」ボタン）。流すか一覧を開いていれば読む
  const [commentsOn, setCommentsOn] = useState(true);
  // 実況コメント。主のトラックと、外から取り込んだ追加のトラック（元の Web 版と同じく、開いたら読む）
  const commentsQ = useComments(target, node);
  // 流すトラック。既定は全て（主＋取り込んだ物を時刻順に。元と同じ）。動画が替わると作り直されて全てに戻る
  const [commentTrack, setCommentTrack] = useState(ALL_COMMENT_TRACKS);
  const commentTracks = commentsQ.data ? commentTrackNames(commentsQ.data) : null;
  const comments = useMemo(() => (commentsQ.data ? selectCommentTrack(commentsQ.data, commentTrack) : undefined), [commentsQ.data, commentTrack]);
  // 取り込んだコメントしか無い動画でもコメントがあるとみなす（元と同じ）
  const hasComments = (meta?.comment_count ?? 0) > 0 || !!commentTracks;
  // 弾幕に流すもの（ミュートを除く。一覧には全部出す）と表示の設定
  const cs = useCommentSettings();
  const flowing = useMemo(() => (comments ? unmutedComments(comments, cs) : null), [comments, cs]);
  const danmaku = { opacity: cs.comment_opacity, scale: cs.comment_font_scale, maxOnScreen: cs.comment_max_onscreen };
  // 焼き込みの PiP（iOS）へ渡すコメント。サーバーの形のまま（前の iOS アプリと同じ読み方をする）
  const pipComments = useMemo(() => (Platform.OS === 'ios' && flowing ? JSON.stringify({ comments: flowing }) : null), [flowing]);
  // 字幕（元の「字」）。字幕のある動画だけ
  const [captionOn, setCaptionOn] = useState(true);
  const captions = useCaptions(target, '1', node, captionOn && !!meta?.has_caption);
  const pipCaptions = useMemo(() => (Platform.OS === 'ios' && captions.data ? JSON.stringify({ captions: captions.data }) : null), [captions.data]);

  return {
    commentsOn, setCommentsOn, toggleComments: () => setCommentsOn((x) => !x), comments, commentTracks, commentTrack, setCommentTrack, hasComments,
    flowing, danmaku, settings: cs, pipComments, captionOn, setCaptionOn, toggleCaption: () => setCaptionOn((x) => !x), captions: captions.data ?? null, pipCaptions,
  };
}

export type CommentLayers = ReturnType<typeof useCommentLayers>;
