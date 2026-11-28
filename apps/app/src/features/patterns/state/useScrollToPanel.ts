import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ScrollViewInstance } from 'react-native';

/**
 * 押したら下の欄まで動かす（押したことが分かるように）。open() を呼ぶたびに動かす（同じ欄を続けて開いても）。
 * 欄がまだ無ければ出た所を測ってから、もう出ていれば今の位置へ。中身が入れ替わって位置がずれた時も少しの間は追う。
 * 欄の onLayout に onLayout を、欄を閉じた時に closed() を渡す
 */
export function useScrollToPanel(scroll: RefObject<ScrollViewInstance | null>) {
  const y = useRef<number | null>(null);
  const pending = useRef(false);
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    if (!seq) return;
    if (y.current != null) scroll.current?.scrollTo({ y: y.current, animated: true });
    pending.current = true;
    const t = setTimeout(() => { pending.current = false; }, 1000);
    return () => clearTimeout(t);
  }, [seq, scroll]);
  return {
    open: () => setSeq((n) => n + 1),
    closed: () => { y.current = null; },
    onLayout: (top: number) => {
      y.current = top;
      if (pending.current) scroll.current?.scrollTo({ y: top, animated: true });
    },
  };
}
