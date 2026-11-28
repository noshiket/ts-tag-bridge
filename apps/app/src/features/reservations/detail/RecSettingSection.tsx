import { initRecSetting, recSettingPayload, recSettingSummary, type RecSettingRaw, type ReserveDetail } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { RecSettingFormView } from '../../recsetting/RecSettingForm';
import { oklch } from '../../../ui/theme/oklch';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { Sheet } from '../../../ui/sheets/Sheet';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/** 録画設定（今の値のまとめと、EDCB 風の設定のシート）。元の detail_res.jsx の「録画設定」 */
export function RecSettingSection({ r, node }: { r: ReserveDetail; node: string | null }) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme } = useTheme();
  const original = initRecSetting(r.rec_setting as RecSettingRaw);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(original);
  const [saved, setSaved] = useState(false);
  const opts = useQuery({ queryKey: ['recSettingOptions', node ?? ''], queryFn: () => api.recSetting.options(node), enabled: open });
  const tuners = useQuery({ queryKey: ['tuners', node ?? ''], queryFn: () => api.recSetting.tuners(node), enabled: open });
  const save = async () => {
    try {
      await api.recSetting.saveReserve(r.reserve_id, recSettingPayload(value), node);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void qc.invalidateQueries({ queryKey: ['reserves', node ?? ''] });
    } catch (e) {
      setSaved(false);
      alert(tx('common.saveFailed', { v0: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <View style={styles.section}>
      <SectionTitle>{tx('reservations.recSettingSection.recordingSettings')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
        <View style={styles.summary}>
          {recSettingSummary(original).map((t) => (
            <View key={t} style={[styles.chip, { borderColor: theme.line, backgroundColor: theme.surface2 }]}><T mono size={10} dim>{t}</T></View>
          ))}
        </View>
        <Pressable onPress={() => { setValue(original); setOpen(true); }} style={[styles.open, { backgroundColor: theme.ink, borderColor: theme.frame }]}>
          <T mono size={12} w={800} color={theme.onInk}>{tx('reservations.recSettingSection.openRecordingSettings')}</T>
        </Pressable>
      </View>
      <Sheet open={open} onClose={() => setOpen(false)} title={tx('reservations.recSettingSection.recordingSettingsChangeReserve')}>
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.scroll}>
          <RecSettingFormView value={value} onChange={setValue} recOpts={opts.data} tuners={tuners.data} original={original} />
        </ScrollView>
        <View style={styles.foot}>
          <Pressable onPress={() => void save()} style={[styles.btn, { backgroundColor: saved ? oklch(0.72, 0.2, 135) : theme.ink, borderColor: theme.frame }]}>
            <T mono size={12} w={800} color={saved ? '#fff' : theme.onInk}>{saved ? tx('reservations.recSettingSection.saved') : tx('common.save')}</T>
          </Pressable>
          <Pressable onPress={() => setOpen(false)} style={[styles.btn, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
            <T mono size={12} w={800}>{tx('common.close')}</T>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  card: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden', paddingVertical: 12, paddingHorizontal: 14 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  open: { padding: 10, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  scroll: { maxHeight: 480 },
  foot: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { flex: 1, padding: 11, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
});
