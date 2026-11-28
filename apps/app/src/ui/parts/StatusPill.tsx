import { StyleSheet, View } from 'react-native';

import { Mark } from './Mark';
import { T } from './T';
import { useTheme } from '../theme/Tweaks';

export type PillStatus = 'scheduled' | 'recording' | 'recorded' | 'encoded' | 'skipped' | 'error' | 'queued' | 'running' | 'done';

/** 予約・録画・エンコードの状態の札（元の StatusPill と同じ色・英字） */
export function StatusPill({ status }: { status: PillStatus }) {
  const { theme, accent } = useTheme();
  const map: Record<PillStatus, { c: string; e: string }> = {
    scheduled: { c: accent.tertiary, e: 'SCHEDULED' },
    recording: { c: '#FF2335', e: 'RECORDING' },
    recorded: { c: accent.secondary, e: 'RECORDED' },
    encoded: { c: accent.quaternary, e: 'ENCODED' },
    skipped: { c: theme.mute, e: 'SKIPPED' },
    error: { c: '#E62B34', e: 'ERROR' },
    queued: { c: accent.primary, e: 'QUEUED' },
    running: { c: accent.primary, e: 'RUNNING' },
    done: { c: accent.quaternary, e: 'DONE' },
  };
  const m = map[status] ?? map.scheduled;
  return (
    <Mark bg={m.c} fg="#fff" urgent={status === 'recording' || status === 'error'} style={[styles.pill, { borderColor: theme.frame }]}>
      {(fg) => <>
        {status === 'recording' && <View style={styles.dot} />}
        <T mono size={9} w={700} color={fg} style={styles.text}>{m.e}</T>
      </>}
    </Mark>
  );
}

const styles = StyleSheet.create({
  // 予約・エンコードのカードは札の段を高さ 18 で切るので、その中に収める（等幅の書体は行の高さが大きく、
  // 上下 3 の余白では 21 になり、iOS で文字の下半分が切れていた）
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 1.5, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1.5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff' },
  text: { letterSpacing: 0.6, lineHeight: 12 },
});
