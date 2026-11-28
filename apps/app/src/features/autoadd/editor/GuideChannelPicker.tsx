import { Pressable, StyleSheet, View } from 'react-native';

import { ClearLink, Field, formStyles } from '../../search/formParts';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 配信の局（'<番組表アドオン名>/<局ID>'） */
export type GuideChannel = { key: string; name: string; guideLabel: string };

/**
 * 番組表アドオンの局（配信など）。選んだ局の番組表にもこのルールを当てて、配信の予約録画アドオンが予約する。
 * 番組表ごとに全選択/全解除。EDCB の局を選んでいる間は選べない
 */
export function GuideChannelPicker({ guideChans, recorderLabel, addonChs, setAddonChs, edcbMode }: {
  guideChans: GuideChannel[]; recorderLabel: string; addonChs: string[]; setAddonChs: (f: (p: string[]) => string[]) => void; edcbMode: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  return (
    <View>
      <View style={formStyles.row}>
        <Field k="配信の局" l={tx('autoReserve.guideChannelPicker.alsoMatchedAgainstSelected', { v0: recorderLabel })} subOpacity={0.5} />
        {addonChs.length > 0 && <ClearLink onPress={() => setAddonChs(() => [])} />}
      </View>
      {edcbMode && <T size={10} dim style={styles.mb4}>{tx('autoReserve.guideChannelPicker.notAvailableWhileStations')}</T>}
      <View style={edcbMode ? styles.off : undefined} pointerEvents={edcbMode ? 'none' : 'auto'}>
        {[...new Set(guideChans.map((c) => c.guideLabel))].map((label) => {
          const chans = guideChans.filter((c) => c.guideLabel === label);
          const allOn = chans.every((c) => addonChs.includes(c.key));
          return (
            <View key={label} style={styles.mb6}>
              <View style={[formStyles.row, styles.mb4]}>
                <T size={10} w={800}>{label}</T>
                <Pressable onPress={() => setAddonChs((p) => (allOn ? p.filter((k) => !chans.some((c) => c.key === k)) : [...p, ...chans.map((c) => c.key).filter((k) => !p.includes(k))]))}
                  style={[styles.mini, { borderColor: theme.line }]}>
                  <T size={9} dim>{allOn ? tx('autoReserve.guideChannelPicker.clearAll') : tx('common.selectAll')}</T>
                </Pressable>
              </View>
              <View style={styles.wrap4}>
                {chans.map((c) => {
                  const on = addonChs.includes(c.key);
                  return (
                    <Pressable key={c.key} onPress={() => setAddonChs((p) => (p.includes(c.key) ? p.filter((x) => x !== c.key) : [...p, c.key]))}
                      style={[styles.ch, { borderColor: on ? accent.primary : theme.line, backgroundColor: on ? accent.primary : 'transparent' }]}>
                      <T size={10} w={700} color={on ? '#fff' : theme.ink}>{c.name}</T>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap4: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  mb4: { marginBottom: 4 },
  mb6: { marginBottom: 6 },
  off: { opacity: 0.35 },
  mini: { paddingVertical: 1, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1 },
  ch: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1.5 },
});
