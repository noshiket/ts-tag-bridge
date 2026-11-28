import { useIsFocused } from 'expo-router';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ライブラリ・設定で見ているサーバー（null はこのサーバー）。元の Web 版の viewNode
interface ViewNode {
  viewNode: string | null;
  setViewNode: (n: string | null) => void;
}

const Ctx = createContext<ViewNode | null>(null);

export function ViewNodeProvider({ children }: { children: ReactNode }) {
  const [viewNode, setViewNode] = useState<string | null>(null);
  return <Ctx.Provider value={{ viewNode, setViewNode }}>{children}</Ctx.Provider>;
}

/**
 * サーバー切り替えの並び（1 が自サーバー、2 からが連携先）と、今の位置・次のサーバー。
 * 切り替えのボタン（useServerSwitch）と、次のサーバーの先読み（usePrefetchOtherServer）で同じ並びを使う
 */
export function serverCycle(peers: { name: string }[], current: string | null) {
  const list: (string | null)[] = [null, ...peers.map((n) => n.name)];
  const i = Math.max(0, list.indexOf(current));
  return { list, i, next: list[(i + 1) % list.length] ?? null };
}

export function useViewNode(): ViewNode {
  const v = useContext(Ctx);
  if (!v) throw new Error('ViewNodeProvider の外で useViewNode を呼んでいます');
  return v;
}

/**
 * 画面ごとの「どのサーバーの物を出しているか」。開いた時のサーバーを覚え、別のサーバーの画面へ進んで
 * 戻ってきた時に、見ているサーバーをそこへ戻す（録画詳細から別のサーバーのアルバムへ飛んで戻ると、
 * 元の録画を別のサーバーで探してしまい出せなかった）。
 * open を渡すとそのサーバーの画面として開く（別のサーバーのアルバム・カテゴリへ飛ぶ時。空文字はこのサーバー）。
 * 出している間に下のボタンでサーバーを切り替えたら、それに付いていく。返り値はこの画面が使うサーバー
 */
export function useScreenNode(open?: string): string | null {
  const { viewNode, setViewNode } = useViewNode();
  const focused = useIsFocused();
  const pinned = useRef<string | null>(open !== undefined ? open || null : viewNode);
  const wasFocused = useRef(false);
  useEffect(() => {
    if (focused && !wasFocused.current) {
      if (viewNode !== pinned.current) setViewNode(pinned.current);   // 戻ってきた・開いた
    } else if (focused) {
      pinned.current = viewNode;                                        // 出している間に切り替えた
    }
    wasFocused.current = focused;
  }, [focused, viewNode, setViewNode]);
  // 戻ってきた直後（見ているサーバーを戻す前）も、この画面のサーバーで取りに行く
  return wasFocused.current ? viewNode : pinned.current;
}
