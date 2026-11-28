import { bandOfOnid, type Band, type Service } from '@tstag/core';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '../parts/T';
import { useTheme } from '../theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

const keyOf = (s: Service) => `${s.onid}-${s.tsid}-${s.sid}`;

/**
 * 放送局を選ぶ（元の shared.jsx の ServicePicker。番組検索・自動予約で使う）。
 * 地デジ / BS / CS に分け、帯ごとに全選択・解除できる（onSetGroup が無い時は出さない）
 */
export function ServicePicker({ services, selected, onToggle, onSetGroup }: {
  services: Service[] | undefined;
  /** 'onid-tsid-sid' */
  selected: string[];
  onToggle: (key: string) => void;
  onSetGroup?: (keys: string[], on: boolean) => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  if (!services?.length) return <T size={10} dim>{tx('common.loading')}</T>;
  const groups = ([[tx('common.terrestrial'), 'terr', accent.secondary], ['BS', 'bs', accent.tertiary], ['CS', 'cs', accent.quaternary]] as [string, Band, string][])
    .map(([label, band, color]) => ({ label, color, svcs: services.filter((s) => bandOfOnid(s.onid) === band) }))
    .filter((g) => g.svcs.length > 0);
  const sel = new Set(selected);
  return (
    <>
      {groups.map((g) => {
        const keys = g.svcs.map(keyOf);
        const allOn = keys.every((k) => sel.has(k));
        return (
          <Fragment key={g.label}>
            <View style={styles.head}>
              <T mono size={8} dim>{g.label}</T>
              {onSetGroup && (
                <Pressable onPress={() => onSetGroup(keys, !allOn)} style={[styles.mini, { borderColor: theme.line }]}>
                  <T mono size={9} dim>{allOn ? tx('common.remove') : tx('common.selectAll')}</T>
                </Pressable>
              )}
            </View>
            <View style={styles.wrap}>
              {g.svcs.map((s) => {
                const k = keyOf(s);
                const on = sel.has(k);
                return (
                  <Pressable key={k} onPress={() => onToggle(k)}
                    style={[styles.svc, { backgroundColor: on ? g.color : 'transparent', borderColor: on ? g.color : theme.line }]}>
                    <T mono size={10} w={700} color={on ? '#fff' : theme.ink} numberOfLines={1}>{s.service_name}</T>
                  </Pressable>
                );
              })}
            </View>
          </Fragment>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  mini: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 999, borderWidth: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  svc: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1.5 },
});
