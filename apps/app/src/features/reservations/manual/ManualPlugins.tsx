import { TextInput } from 'react-native';

import { Box, Cell, Hint, Row, useSmallInput } from './manualParts';
import type { ManualReserve } from './useManualReserve';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { Select } from '../../../ui/inputs/Select';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** プラグイン（プリセット・書き出し・ファイル名とその引数・録画後 BAT とタグ）。候補があれば選び、無ければ打つ */
export function ManualPlugins({ m }: { m: ManualReserve }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const small = useSmallInput();
  const { form, set, o } = m;
  const pick = (k: 'writePlugIn' | 'recNamePlugIn' | 'batFilePath', label: string, list: { value: string; label: string }[] | undefined) =>
    list?.length
      ? <Select label={label} value={form[k]} options={[{ value: '', label: tx('common.none') }, ...list]} onChange={(v) => set(k, v)} />
      : <TextInput value={form[k]} onChangeText={(v) => set(k, v)} placeholder={tx('common.none')} placeholderTextColor={theme.mute} style={small} />;
  return (
    <>
      <SectionTitle>{tx('reservations.manualPlugins.plugInsPlugSettings')}</SectionTitle>
      <Box>
        {!!o?.presets?.length && (
          <Row en="presetID" ja="プリセット" def="デフォルト">
            <Select label={tx('common.preset')} value={form.presetID} onChange={(v) => set('presetID', v)}
              options={[{ value: '', label: tx('reservations.manualPlugins.default') }, ...o.presets.map((p) => ({ value: String(p.value), label: p.label }))]} />
          </Row>
        )}
        <Cell>
          <Hint en="writePlugIn — 書き出しプラグイン" rest={tx('reservations.manualPlugins.blank', { v0: o?.defaultWritePlugIn || tx('common.setting') })} />
          {pick('writePlugIn', tx('reservations.manualPlugins.writePlug'), o?.writePlugIn)}
        </Cell>
        <Cell>
          <Hint en="recNamePlugIn — ファイル名プラグイン" rest={tx('reservations.manualPlugins.blank', { v0: o?.defaultRecNamePlugIn || tx('common.setting') })} />
          {pick('recNamePlugIn', tx('reservations.manualPlugins.fileNamePlug'), o?.recNamePlugIn)}
        </Cell>
        <Cell>
          <Hint en="recName — ファイル名オプション（recNamePlugIn の引数）" rest=" / 空欄 → プラグインに渡されない" />
          <TextInput value={form.recName} onChangeText={(v) => set('recName', v)} placeholder={tx('common.omitted')} placeholderTextColor={theme.mute} style={small} />
        </Cell>
        <Cell>
          <Hint en="batFilePath — 録画後 BAT" rest=" / 空欄 → 実行しない" />
          {pick('batFilePath', tx('reservations.manualPlugins.postRecording'), o?.batFilePath)}
        </Cell>
        <Cell last>
          <Hint en="batFileTag — BAT タグ" rest=" / 空欄 → タグなし（batFilePath のみ送信）" />
          <TextInput value={form.batFileTag} onChangeText={(v) => set('batFileTag', v)} placeholder={tx('common.omitted')} placeholderTextColor={theme.mute} style={small} />
        </Cell>
      </Box>
    </>
  );
}
