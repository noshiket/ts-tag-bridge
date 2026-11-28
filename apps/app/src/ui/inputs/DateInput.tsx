import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Cal, Chev } from '../parts/Icons';
import { Sheet } from '../sheets/Sheet';
import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * 日付の欄（Web の <input type="date"> の代わり）。打っても入れられ、右のカレンダーを押すと月の表から選べる。
 * withTime: 値が日時（YYYY-MM-DDTHH:MM:SS）の欄。選んだ時は日付の所だけ替え、時刻は残す（無ければ 00:00:00）
 */
export function DateInput({ value, onChangeText, placeholder = 'YYYY-MM-DD', style, wrapStyle, withTime }: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
  wrapStyle?: StyleProp<ViewStyle>;
  withTime?: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [open, setOpen] = useState(false);
  const cur = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  const now = new Date();
  const today = ymd(now.getFullYear(), now.getMonth(), now.getDate());
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]);
  /** 年月を押すと月の一覧にする（遠くの月へ一気に飛ぶため） */
  const [months, setMonths] = useState(false);
  const show = () => {
    setYm(cur ? [Number(cur[1]), Number(cur[2]) - 1] : [now.getFullYear(), now.getMonth()]);
    setMonths(false);
    setOpen(true);
  };
  const pick = (d: string) => {
    setOpen(false);
    onChangeText(withTime ? d + (value && value.length > 10 ? value.slice(10) : 'T00:00:00') : d);
  };
  const move = (n: number) => setYm(([y, m]) => { const t = new Date(y, m + n, 1); return [t.getFullYear(), t.getMonth()]; });
  const [y, m] = ym;
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const sel = cur ? cur[0] : '';
  return (
    <View style={[styles.wrap, wrapStyle]}>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.mute}
        autoCorrect={false} autoCapitalize="none" keyboardType="numbers-and-punctuation"
        style={[style, styles.input]} />
      <Pressable onPress={show} accessibilityRole="button" accessibilityLabel={tx('ui.dateInput.pickCalendar')} hitSlop={6} style={styles.btn}>
        <Cal s={14} c={theme.mute} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={tx('ui.dateInput.pickDate')}>
        <View style={styles.nav}>
          <Pressable onPress={() => move(-12)} hitSlop={6} accessibilityLabel={tx('ui.dateInput.previousYear')} style={[styles.navBtn, { borderColor: theme.line }]}><Chev s={12} c={theme.ink} d="left" /><Chev s={12} c={theme.ink} d="left" /></Pressable>
          {!months && <Pressable onPress={() => move(-1)} hitSlop={6} accessibilityLabel={tx('ui.dateInput.previousMonth')} style={[styles.navBtn, { borderColor: theme.line }]}><Chev s={12} c={theme.ink} d="left" /></Pressable>}
          <Pressable onPress={() => setMonths((v) => !v)} accessibilityRole="button" accessibilityLabel={tx('ui.dateInput.pickYearMonth')}
            style={[styles.navBtn, styles.ymBtn, { borderColor: months ? accent.primary : theme.line }]}>
            <T size={14} w={800}>{months ? tx('date.year', { y }) : tx('date.ym', { y, m: m + 1 })}</T>
            <Chev s={10} c={theme.mute} d={months ? 'up' : 'down'} />
          </Pressable>
          {!months && <Pressable onPress={() => move(1)} hitSlop={6} accessibilityLabel={tx('ui.dateInput.nextMonth')} style={[styles.navBtn, { borderColor: theme.line }]}><Chev s={12} c={theme.ink} /></Pressable>}
          <Pressable onPress={() => move(12)} hitSlop={6} accessibilityLabel={tx('ui.dateInput.nextYear')} style={[styles.navBtn, { borderColor: theme.line }]}><Chev s={12} c={theme.ink} /><Chev s={12} c={theme.ink} /></Pressable>
        </View>
        {months ? (
          <View style={styles.grid}>
            {Array.from({ length: 12 }, (_, i) => {
              const on = i === m;
              const isNow = y === now.getFullYear() && i === now.getMonth();
              return (
                <Pressable key={i} onPress={() => { setYm([y, i]); setMonths(false); }} style={styles.monthCell}>
                  <View style={[styles.month, on ? { backgroundColor: accent.primary } : { borderColor: isNow ? theme.ink : theme.line, borderWidth: isNow ? 1.5 : 1 }]}>
                    <T size={13} w={on ? 800 : 700} color={on ? '#fff' : theme.ink}>{tx('ui.dateInput.month', { v0: i + 1 })}</T>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
        <View style={styles.grid}>
          {tx('date.week').split(',').map((w, i) => (
            <View key={w} style={styles.cell}><T size={10} w={700} color={i === 0 ? '#E62B34' : i === 6 ? accent.tertiary : theme.mute}>{w}</T></View>
          ))}
          {cells.map((d, i) => {
            if (d == null) return <View key={`e${i}`} style={styles.cell} />;
            const k = ymd(y, m, d);
            const on = k === sel;
            return (
              <Pressable key={k} onPress={() => pick(k)} style={styles.cell}>
                <View style={[styles.day, on && { backgroundColor: accent.primary }, !on && k === today && { borderColor: theme.frame, borderWidth: 1.5 }]}>
                  <T size={13} w={on ? 800 : 500} color={on ? '#fff' : i % 7 === 0 ? '#E62B34' : i % 7 === 6 ? accent.tertiary : theme.ink}>{d}</T>
                </View>
              </Pressable>
            );
          })}
        </View>
        )}
        <Pressable onPress={() => pick(today)} style={[styles.navBtn, styles.todayBtn, { borderColor: theme.line }]}><T size={12} w={700}>{tx('ui.dateInput.today')}</T></Pressable>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  // カレンダーのボタンの分だけ右を空ける（渡された style より後に当てる）
  input: { paddingRight: 28 },
  btn: { position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center' },
  nav: { flexDirection: 'row', gap: 6, marginTop: 10, marginBottom: 6 },
  navBtn: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ymBtn: { flex: 1, gap: 6, marginHorizontal: 2 },
  todayBtn: { marginBottom: 10 },
  monthCell: { width: '25%', padding: 4 },
  month: { height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  cell: { width: `${100 / 7}%`, height: 42, alignItems: 'center', justifyContent: 'center' },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
