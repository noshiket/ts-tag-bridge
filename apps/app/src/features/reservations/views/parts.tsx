import { TUNER_SHORTAGE, type Reserve, type ReserveStatus } from '@tstag/core';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { GOTHIC } from '../../../ui/parts/Num';
import { T } from '../../../ui/parts/T';
import { danger } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import type { Tr } from '../../../ui/i18n/I18n';

// テロップ・テレビ欄の表示で共通の部品（数字の書体は ui/parts/Num）

export const RECORDING = '#FF2335';
/** BonDriver の名前を短く（BonDriver_LinuxPTX-0.so → LinuxPTX-0） */
export const tunerLabel = (name: string) => name.replace(/^BonDriver_/i, '').replace(/\.(so|dll)$/i, '');
/** 字・再・新などの印。fill はテレビ欄の黒い四角、そうでなければ枠だけ（テロップ） */
export function TitleMarks({ marks, fill, size = 11, style }: { marks: string[]; fill?: boolean; size?: number; style?: ViewStyle }) {
  const { theme } = useTheme();
  if (!marks.length) return null;
  return (
    <View style={[styles.marks, style]}>
      {marks.map((m, i) => (
        <View key={i} style={[styles.mark, { minWidth: size + 4, height: size + 4 }, fill ? { backgroundColor: theme.ink } : { borderWidth: 1.5, borderColor: theme.ink }]}>
          <T size={size - 1} w={700} color={fill ? theme.onInk : theme.ink} style={[GOTHIC, { lineHeight: size + 1 }]}>{m}</T>
        </View>
      ))}
    </View>
  );
}

/** 知らせたいこと（大事な順）。先頭はテロップの帯にも使う */
export function reserveAlerts(r: Reserve, status: ReserveStatus, tuner: string | undefined, theme: { ink: string; onInk: string }, tx: Tr) {
  const a: { label: string; c: string; fg: string }[] = [];
  if (status === 'recording') a.push({ label: tx('reservations.list.alert.recording'), c: RECORDING, fg: '#fff' });
  if (status === 'error') a.push({ label: tx('reservations.list.alert.error'), c: danger, fg: '#fff' });
  if (tuner === TUNER_SHORTAGE) a.push({ label: tx('reservations.list.alert.shortage'), c: danger, fg: '#fff' });
  if (r.rec_enabled === 0) a.push({ label: tx(r.auto_skip_reason === 'duplicate' ? 'reservations.list.alert.skipDup' : 'reservations.list.alert.skip'), c: theme.ink, fg: theme.onInk });
  if (r.overlap_mode) a.push({ label: tx('reservations.list.alert.overlap', { mode: r.overlap_mode }), c: '#FF6853', fg: '#fff' });
  return a;
}

/** 脇の情報（チューナー・自動予約に無い・録画済の数）を 1 行の文に */
export function reserveNotes(r: Reserve, tuner: string | undefined, tx: Tr): string {
  return [
    tuner && tuner !== TUNER_SHORTAGE ? tunerLabel(tuner) : '',
    !r.rule_id && r.rec_enabled !== 0 ? tx('reservations.list.note.dbPlanned') : '',
    r.duplicate_count > 0 ? tx('reservations.list.note.recorded', { n: r.duplicate_count }) : '',
  ].filter(Boolean).join(' · ');
}

/** サブタイトルを「」でくくる（もう付いていればそのまま） */
export const quoted = (s: string) => (!s || /[「『]/.test(s) ? s : `「${s}」`);

/** 11/23 月（曜日は表示言語の辞書から） */
export function dayLabel(iso: string, tx: Tr): string {
  const d = new Date(Date.parse(iso));
  return `${d.getMonth() + 1}/${d.getDate()} ${tx('date.week').split(',')[d.getDay()]}`;
}

const styles = StyleSheet.create({
  marks: { flexDirection: 'row', gap: 3 },
  mark: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 1, borderRadius: 2 },
});
