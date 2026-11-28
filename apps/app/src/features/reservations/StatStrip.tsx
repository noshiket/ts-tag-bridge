import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Num } from '../../ui/parts/Num';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';

export interface StatPart { key: string; v: number; c: string; active: boolean; onPress: () => void; label: string }
export interface StatItem { key: string; label: string; c: string; active: boolean; v?: number; onPress?: () => void; parts?: StatPart[] }

/**
 * 予約一覧の上の件数（全て・予約・スキップ）を1本の帯で。押した区切りで絞り込む。選んでいる区切りはその色で塗る。
 * parts を渡すと「A + B」で出し、それぞれ押して絞り込む（選んでいる方に下線）
 */
export function StatStrip({ items }: { items: StatItem[] }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.strip, { borderColor: theme.frame, backgroundColor: theme.surface }]}>
      {items.map((it, i) => {
        const fg = it.active ? '#fff' : theme.ink;
        return (
          <Pressable key={it.key} onPress={it.parts ? undefined : it.onPress} disabled={!!it.parts || !it.onPress}
            style={[styles.seg, it.parts && styles.wide, { backgroundColor: it.active ? it.c : 'transparent' },
              i > 0 && { borderLeftWidth: 1.5, borderLeftColor: theme.frame }]}>
            <T size={9} w={700} color={it.active ? 'rgba(255,255,255,0.85)' : theme.mute} numberOfLines={1}>{it.label}</T>
            {it.parts ? (
              <View style={styles.parts}>
                {it.parts.map((p, j) => (
                  <Fragment key={p.key}>
                    {j > 0 && <T size={11} w={700} color={it.active ? '#fff' : theme.mute}>+</T>}
                    <Pressable onPress={p.onPress} accessibilityLabel={p.label} hitSlop={6}
                      style={[styles.part, { borderBottomColor: p.active ? fg : 'transparent' }]}>
                      <Num size={18} color={it.active ? fg : p.c === theme.mute ? theme.ink : p.c}>{String(p.v)}</Num>
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            ) : (
              <Num size={18} color={it.active ? fg : it.c}>{String(it.v ?? 0)}</Num>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flex: 1, maxWidth: 560, flexDirection: 'row', borderWidth: 1.5, borderRadius: 11, overflow: 'hidden' },
  seg: { flex: 1, paddingVertical: 4, paddingHorizontal: 9, justifyContent: 'center' },
  wide: { flex: 1.4 },
  parts: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  part: { borderBottomWidth: 2 },
});
