import { initAmzProfileForm, type AmzProfile, type AmzProfileForm as Form } from '@tstag/core';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { EncoderSections } from './EncoderSections';
import { FilterSection } from './FilterSection';
import { Btn, Group, Label, formStyles } from './formParts';
import { OptionSections } from './OptionSections';
import { useProfileFields } from './useProfileFields';
import { oklch } from '../../../../ui/theme/oklch';
import { T } from '../../../../ui/parts/T';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

const WARN = oklch(0.72, 0.2, 30);

/**
 * Amatsukaze のプロファイルの編集（元の AmzProfileForm）: エンコーダー・デコーダー・出力・フィルタ・ビットレート・音声・
 * チャプター/ロゴ/字幕・その他・詳細。新規は名前が要る。既存は上書きか別名で保存
 */
export function AmzProfileForm({ initial, isNew, onSave, onSaveAs, onCancel }: {
  initial?: AmzProfile;
  isNew?: boolean;
  onSave: (p: Form) => Promise<unknown>;
  onSaveAs?: (name: string, p: Form) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [form, setForm] = useState<Form>(() => initAmzProfileForm(initial));
  const f = useProfileFields(form, setForm);
  const [saving, setSaving] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const canSave = isNew ? form.name.trim().length > 0 : true;
  const run = (p: Promise<unknown>) => { setSaving(true); p.catch(() => setSaving(false)); };
  const off = saving || !canSave;
  const asOff = saving || !saveAsName.trim();

  return (
    <View style={[styles.wrap, { borderTopColor: theme.line, backgroundColor: theme.surface2 }]}>
      {isNew && (
        <Group title={tx('settings.amzProfileForm.basics')}>
          <View>
            <Label>name <T mono size={9} color={oklch(0.6, 0.22, 25)}>*</T></Label>
            <TextInput value={form.name} onChangeText={(v) => f.set('name', v)} placeholder={tx('settings.amzProfileForm.eGNc720p')} placeholderTextColor={theme.mute}
              autoCapitalize="none" autoCorrect={false} style={[f.input, { borderColor: form.name.trim() ? theme.ink : WARN }]} />
          </View>
        </Group>
      )}
      <EncoderSections f={f} />
      <FilterSection f={f} />
      <OptionSections f={f} />

      {!saveAsMode ? (
        <View style={formStyles.btns}>
          <Btn flex={2} bg={off ? theme.surface2 : accent.secondary} fg={off ? theme.mute : '#fff'} shadow={!off}
            disabled={off} onPress={() => canSave && run(onSave(form))}>{saving ? tx('common.saving') : isNew ? tx('common.add') : tx('settings.amzProfileForm.overwrite')}</Btn>
          {onSaveAs && !isNew && <Btn flex={2} bg={theme.surface} fg={theme.ink} shadow onPress={() => { setSaveAsMode(true); setSaveAsName(''); }}>{tx('settings.amzProfileForm.save')}</Btn>}
          <Btn flex={1} bg="transparent" fg={theme.ink} onPress={onCancel}>{tx('common.cancel')}</Btn>
        </View>
      ) : (
        <View style={styles.saveAs}>
          <T mono size={9} dim>{tx('settings.amzProfileForm.saveNewProfileName')}</T>
          <TextInput value={saveAsName} onChangeText={setSaveAsName} placeholder={tx('settings.amzProfileForm.eGNc1080p')} placeholderTextColor={theme.mute} autoCapitalize="none"
            style={[f.input, styles.saveAsInput, { borderColor: saveAsName.trim() ? theme.ink : WARN }]} />
          <View style={formStyles.btns}>
            <Btn flex={2} bg={asOff ? theme.surface2 : accent.primary} fg={asOff ? theme.mute : '#fff'} shadow={!asOff} disabled={asOff}
              onPress={() => onSaveAs && run(onSaveAs(saveAsName.trim(), form))}>{saving ? tx('common.saving') : tx('settings.amzProfileForm.addNew')}</Btn>
            <Btn flex={1} bg="transparent" fg={theme.ink} onPress={() => setSaveAsMode(false)}>{tx('common.back')}</Btn>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 10, paddingBottom: 14, paddingHorizontal: 13, borderTopWidth: 1, borderStyle: 'dashed', gap: 14 },
  saveAs: { gap: 8 },
  saveAsInput: { fontSize: 12 },
});
