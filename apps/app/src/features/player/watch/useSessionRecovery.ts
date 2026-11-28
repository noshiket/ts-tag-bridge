import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

/** サーバーは 10 秒使われていない配信のセッションを片付ける。それより少し短く見る */
const SESSION_IDLE_MS = 8_000;
/** 作り直しても続けて失敗する時は、作り直しを繰り返さずエラーを見せる */
const RETRY_GAP_MS = 20_000;

/**
 * 配信のセッションが片付けられていたら、その位置から作り直して再生を続ける。
 * iPhone の Safari は画面を裏に回すとページを止め、続いているよの知らせ（keep-alive）も止まる。
 * 10 秒を超えるとサーバーがセッションを片付け、戻った時に区切りの取得がすべて断られて
 * 「再生できません: fragLoadError」で止まっていた（2026-11-20、24 秒止まっていた）。
 * - 裏から戻った時、8 秒以上止まっていたら先に作り直す
 * - それでも読み込みに失敗したら1回だけ作り直す（20 秒以内に続けて失敗したらエラーを見せる）
 * active: サーバーのセッションで再生している（端末の保存・直接再生では何もしない）。
 * 再生の状態（status）と、プレイヤーを作り直す番号（playerKey。VideoSurface の key）もここで持つ
 */
export function useSessionRecovery(active: boolean, restartSession: () => void) {
  const [status, setStatus] = useState<{ s: 'loading' | 'ready' | 'error'; msg?: string }>({ s: 'loading' });
  const [playerKey, setPlayerKey] = useState(0);
  /** 今の位置から、新しいセッション・新しいプレイヤーで出し直す（メニューの「プレイヤーを再起動」も） */
  const restart = () => { restartSession(); setPlayerKey((k) => k + 1); };
  const hiddenAt = useRef<number | null>(null);
  const lastRetry = useRef(0);
  const live = useRef({ active, restart });
  live.current = { active, restart };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') { hiddenAt.current ??= Date.now(); return; }
      const away = hiddenAt.current == null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      if (live.current.active && away >= SESSION_IDLE_MS) { lastRetry.current = Date.now(); live.current.restart(); }
    });
    return () => sub.remove();
  }, []);

  /** VideoSurface の onStatus に渡す */
  const onStatus = (s: 'loading' | 'ready' | 'error', msg?: string) => {
    if (s === 'error' && live.current.active && Date.now() - lastRetry.current > RETRY_GAP_MS) {
      lastRetry.current = Date.now();
      setStatus({ s: 'loading' });
      live.current.restart();
      return;
    }
    setStatus({ s, msg });
  };
  return { status, onStatus, playerKey, restartPlayer: restart };
}
