import { initSegs, segPattern, segText, segmentsFromPattern, segmentsFromPattern2, type Analyzer, type PatternCtx, type Segment } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useRef, useState } from 'react';

/**
 * パターンビルダーの文字の区切り（番組名・番組説明・詳細情報）。照合と同じそろえ方の文字で始め、
 * 既存パターンを開いた時はそのパターンの区切りにし（populate）、閉じた時に戻す（restore）
 */
export function useBuilderSegments(ctx: PatternCtx | null, screen?: boolean) {
  const api = useApi();
  const [titleSegs, setTitleSegs] = useState<Segment[]>(() => initSegs(ctx?.title ?? ''));
  const [descSegs, setDescSegs] = useState<Segment[]>(() => initSegs(ctx?.description ?? ''));
  const [extSegs, setExtSegs] = useState<Segment[]>(() => initSegs(ctx?.extended_info ?? ''));
  // 照合と同じそろえ方（全角半角など）にした文字で始める
  useEffect(() => {
    if (!ctx) return;
    api.patterns.normalize({ title: ctx.title, description: ctx.description, extended_info: ctx.extended_info }).then((t) => {
      setTitleSegs(initSegs(t.title || '')); setDescSegs(initSegs(t.description || '')); setExtSegs(initSegs(t.extended_info || ''));
    }).catch(() => {});
  }, [api, ctx?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizedTitle = segText(titleSegs);
  const patternsBySource: Record<string, string> = { $title: segPattern(titleSegs), $description: segPattern(descSegs), $extended_info: segPattern(extSegs) };
  const normTitleForRestore = useRef('');

  const populate = (a: Analyzer) => {
    normTitleForRestore.current = normalizedTitle;
    const t = segmentsFromPattern(normalizedTitle, a.pattern);
    if (t) setTitleSegs(t);
    if (a.pattern2 && a.text2) {
      const p2 = segmentsFromPattern2(a.text2 === '$extended_info' ? segText(extSegs) : a.text2 === '$description' ? segText(descSegs) : '', a.pattern2, !screen);
      if (p2) { if (a.text2 === '$description') setDescSegs(p2); else setExtSegs(p2); }
    }
  };
  /** 欄を閉じた時: 新規なら付けたグループを外し、既存を開いていたら開く前の題名に戻す */
  const restore = (wasNew: boolean) => {
    setTitleSegs(initSegs(wasNew ? normalizedTitle : normTitleForRestore.current));
    setDescSegs(initSegs(ctx?.description ?? '')); setExtSegs(initSegs(ctx?.extended_info ?? ''));
  };

  return { titleSegs, setTitleSegs, descSegs, setDescSegs, extSegs, setExtSegs, normalizedTitle, patternsBySource, populate, restore };
}
