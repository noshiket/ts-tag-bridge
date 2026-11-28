import { presetValues, type AmzServer } from '@tstag/core';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { oklch } from '../../ui/theme/oklch';
import { Select } from '../../ui/inputs/Select';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';
import { Field, withBlank } from './encodeFields';

type Preset = Record<string, unknown> & { outputs?: Record<string, unknown> };
const WARN = oklch(0.7, 0.17, 60);

/** 録画のエンコード設定の Amatsukaze の欄（プリセットの呼び出し・入力・mode・出力先・プロファイル） */
export function AmzPresetFields({ server, preset, profiles, inputStyle, onPreset, onPatch }: {
  server: AmzServer | undefined;
  preset: Preset;
  profiles: { name: string }[];
  inputStyle: StyleProp<TextStyle>;
  onPreset: (p: Record<string, unknown>) => void;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  return (
    <View style={styles.mb10}>
      {(server?.encode_preset ?? []).length > 0 && (
        <Field label={tx('detail.encodeSettings.presetsInputShortcuts')}>
          <View style={styles.pills}>
            {server!.encode_preset!.map((p) => (
              <Pressable key={p.name} onPress={() => onPreset(presetValues(p))} style={[styles.pill, { borderColor: theme.line }]}>
                <T mono size={10}>{p.name}</T>
              </Pressable>
            ))}
          </View>
        </Field>
      )}
      {(['input_ts', 'add_queue_bat'] as const).map((k) => (
        <Field key={k} label={k}>
          <TextInput value={String(preset[k] ?? '')} onChangeText={(x) => onPatch({ [k]: x })} autoCapitalize="none" autoCorrect={false} style={inputStyle} />
        </Field>
      ))}
      <Field label="mode">
        <Select label="mode" value={String(preset.mode ?? 'Batch')} onChange={(m) => onPatch({ mode: m })}
          options={['Batch', 'Test', 'DrcsCheck', 'CMCheck'].map((m) => ({ value: m, label: m }))} />
        {/* Test 以外は Amatsukaze が終わった後に入力のファイルを動かすので、このアプリから追えなくなる */}
        <T size={9} color={String(preset.mode ?? 'Batch') === 'Test' ? theme.mute : WARN} style={styles.note}>{tx('detail.encodeSettings.modeNote')}</T>
      </Field>
      <Field label="outputs.dstPath">
        <TextInput value={String(preset.outputs?.dstPath ?? '')} onChangeText={(x) => onPatch({ outputs: { ...(preset.outputs ?? {}), dstPath: x } })}
          autoCapitalize="none" autoCorrect={false} style={inputStyle} />
      </Field>
      <Field label="outputs.profile">
        <Select label="outputs.profile" value={String(preset.outputs?.profile ?? '')} onChange={(x) => onPatch({ outputs: { ...(preset.outputs ?? {}), profile: x } })}
          options={withBlank(profiles.map((p) => ({ value: p.name, label: p.name })), tx('detail.encodeSettings.select'))} />
      </Field>
    </View>
  );
}

const styles = StyleSheet.create({
  mb10: { marginBottom: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  pill: { paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5 },
  note: { marginTop: 4, lineHeight: 14 },
});
