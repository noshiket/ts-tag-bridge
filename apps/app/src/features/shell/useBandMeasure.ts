import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, type ComponentRef } from 'react';
import { View } from 'react-native';

import { miniBand } from '../../lib/playback/miniBand';

let seq = 1;
/** 画面を移った動き（スタックの出入り）が終わってから測り直す */
const SETTLE_MS = 400;

/**
 * 帯のサムネの枠の位置を、前に出ている画面の帯だけが miniBand に載せる（再生中のプレイヤーをそこへ縮めて出す）
 */
export function useBandMeasure() {
  const id = useRef(seq++).current;
  const ref = useRef<ComponentRef<typeof View>>(null);
  const focused = useIsFocused();
  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => { if (width > 0 && height > 0) miniBand.set(id, { x, y, width, height }); });
  }, [id]);
  useEffect(() => {
    if (!focused) return;
    measure();
    const t = setTimeout(measure, SETTLE_MS);
    return () => { clearTimeout(t); miniBand.set(id, null); };
  }, [focused, measure, id]);
  const onLayout = () => { if (focused) measure(); };
  return { ref, onLayout };
}
