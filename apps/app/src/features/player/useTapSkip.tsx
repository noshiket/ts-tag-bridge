import { tNow } from '../../ui/i18n/I18n';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import { T } from '../../ui/parts/T';

type Side = 'left' | 'right';

/**
 * 押した所の左右。iOS は locationX。Web の onPress は DOM のクリックで locationX が無いので、
 * 押した枠の位置と clientX/clientY から出す。横画面 ⟳ は画面を 90° 回しているので、画面の縦位置が
 * 体感の左右（上=左）になる。回しているかは rot.rotated で受け取る（枠の縦横比では、大画面の縦長の並びと
 * 横画面を区別できない）
 */
function tapSide(e: GestureResponderEvent, rotated: boolean, width: number): Side {
  const n = e.nativeEvent as unknown as { locationX?: number; clientX?: number; clientY?: number };
  if (Platform.OS !== 'web' && typeof n.locationX === 'number') return n.locationX < (width || 1) / 2 ? 'left' : 'right';
  const el = e.currentTarget as unknown as {
    getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
  };
  const r = el?.getBoundingClientRect?.();
  if (r && typeof n.clientX === 'number' && typeof n.clientY === 'number') {
    const frac = rotated
      ? (n.clientY - r.top) / (r.height || 1)
      : (n.clientX - r.left) / (r.width || 1);
    return frac < 0.5 ? 'left' : 'right';
  }
  return (n.locationX ?? 0) < (width || 1) / 2 ? 'left' : 'right';
}

/**
 * 続けてタップで飛ばす（元の Web 版と同じ 動画プレイヤーでよくある形）: 2回目からタップごとに左は10秒戻る・右は10秒進む。
 * 1回だけなら少し待ってから onSingleTap（操作の表示の出し入れ）。2回目が来たら取りやめる。
 * 返す feedback は映像の上に置く（飛ばした秒数を左右に少し出す）
 */
export function useTapSkip({ width, rotated, skip, onSingleTap }: { width: () => number; rotated: boolean; skip: (sec: number) => void; onSingleTap: () => void }) {
  const tapRef = useRef<{ count: number; side: Side | null; timer: ReturnType<typeof setTimeout> | null }>({ count: 0, side: null, timer: null });
  const [shown, setShown] = useState<{ side: Side; secs: number } | null>(null);
  const fbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 待っている間に描き直されても、最新の操作を呼ぶ
  const single = useRef(onSingleTap);
  single.current = onSingleTap;
  useEffect(() => () => {
    if (tapRef.current.timer) clearTimeout(tapRef.current.timer);
    if (fbTimer.current) clearTimeout(fbTimer.current);
  }, []);

  const onTap = (e: GestureResponderEvent) => {
    const side = tapSide(e, rotated, width());
    const t = tapRef.current;
    if (t.timer) clearTimeout(t.timer);
    // 側を替えたら、その2回目から数え直す
    if (t.count > 0 && t.side !== side) t.count = 1;
    t.side = side;
    t.count += 1;
    if (t.count === 1) {
      t.timer = setTimeout(() => { t.count = 0; t.side = null; t.timer = null; single.current(); }, 280);
      return;
    }
    skip(side === 'left' ? -10 : 10);
    setShown({ side, secs: (t.count - 1) * 10 });
    if (fbTimer.current) clearTimeout(fbTimer.current);
    fbTimer.current = setTimeout(() => setShown(null), 700);
    t.timer = setTimeout(() => { t.count = 0; t.side = null; t.timer = null; }, 350);
  };

  const feedback = shown && (
    <View pointerEvents="none" style={[styles.fb, shown.side === 'left' ? styles.left : styles.right]}>
      <T mono size={15} w={800} color="#fff">{shown.side === 'left' ? `«« ${tNow('fmt.s', { n: shown.secs })}` : `${tNow('fmt.s', { n: shown.secs })} »»`}</T>
    </View>
  );
  return { onTap, feedback };
}

const styles = StyleSheet.create({
  fb: { position: 'absolute', top: '50%', marginTop: -20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 22, paddingVertical: 10, paddingHorizontal: 16 },
  left: { left: '10%' },
  right: { right: '10%' },
});
