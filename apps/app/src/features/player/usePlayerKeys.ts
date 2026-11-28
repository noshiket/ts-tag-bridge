import { useEffect, useRef, useState } from 'react';

import { handlePlayerKey, type PlayerKeyHandlers } from './playerKeys';

/**
 * 再生画面のキー操作を window に付ける（元の usePlayerKeys）。enabled: 前に出ている時だけ
 * （裏で鳴っているだけの時は他の画面の操作を奪わない）。onActivity はキーのたびに呼ぶ（操作の表示を出し直す）
 */
export function usePlayerKeys(handlers: PlayerKeyHandlers, opts: { enabled: boolean; uiVisible: boolean; onActivity: () => void }) {
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const oRef = useRef(opts);
  oRef.current = opts;
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef(false);
  helpRef.current = helpOpen;

  useEffect(() => {
    // 最後に押した所が横・下の欄（タブの中: パターン・確定値など）か。文字を押しただけではフォーカスが移らず
    // キーは body に届くので、押した所で見分ける。欄の操作中に Backspace で前の画面へ戻された・
    // スペースや矢印が再生・早送りに取られていた
    let inPanel = false;
    const onPointer = (e: PointerEvent) => { inPanel = !!(e.target as HTMLElement | null)?.closest?.('[data-player-panel]'); };
    const onKey = (e: KeyboardEvent) => {
      if (!oRef.current.enabled) return;
      const tg = e.target as HTMLElement | null;
      if (tg?.closest?.('[data-player-panel]') || (inPanel && (tg === document.body || !tg))) return;
      // 入力中は奪わない（コメント入力・検索欄など）
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? '';
      if (t?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // ボタンに当てて操作している最中は、方向キー・決定を奪わない（リモコンでボタンを選べなくなる）
      const tabbable = tag === 'BUTTON' || tag === 'A' || t?.getAttribute?.('role') === 'button';
      if (tabbable && oRef.current.uiVisible && (e.key === 'Enter' || e.key === ' ' || e.code === 'Space' || e.key.startsWith('Arrow'))) return;
      // 全画面中の Escape はブラウザ自身の全画面解除に任せる
      if (e.key === 'Escape' && document.fullscreenElement && !helpRef.current) return;
      const done = handlePlayerKey({ key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }, hRef.current,
        { open: helpRef.current, set: setHelpOpen }, () => oRef.current.onActivity());
      if (done) e.preventDefault();
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey); };
  }, []);

  return { supported: true, helpOpen, setHelpOpen, catcher: null };
}
