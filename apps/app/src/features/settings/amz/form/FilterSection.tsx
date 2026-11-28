import { AMZ_DEBLOCK_STRENGTHS, AMZ_DEINTERLACE_ALGOS, AMZ_FILTER_OPTIONS } from '@tstag/core';
import { StyleSheet, TextInput, View } from 'react-native';

import { Cols, Group, Label, Num, Sel, formStyles } from './formParts';
import type { ProfileFields } from './useProfileFields';
import { useTheme } from '../../../../ui/theme/Tweaks';
import { useT } from '../../../../ui/i18n/I18n';

/** フィルタ: なし / Custom（スクリプトのパス）/ Setting（CUDA・インターレース解除・デブロッキング・リサイズ・その他） */
export function FilterSection({ f }: { f: ProfileFields }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const { form, set, setFlt, fs, str, fchk, input } = f;
  return (
    <Group title={tx('settings.filterSection.filters')}>
      <Sel label="filterOption" value={form.filterOption || 'None'} opts={AMZ_FILTER_OPTIONS} onChange={(v) => set('filterOption', v)} />
      {form.filterOption === 'Custom' && (
        <>
          <View><Label>filterPath</Label><TextInput value={str('filterPath')} onChangeText={(v) => set('filterPath', v)} placeholder={tx('settings.filterSection.mainFilterScriptPath')} placeholderTextColor={f.mute} autoCapitalize="none" style={input} /></View>
          <View><Label>postFilterPath</Label><TextInput value={str('postFilterPath')} onChangeText={(v) => set('postFilterPath', v)} placeholder={tx('settings.filterSection.postFilterPath')} placeholderTextColor={f.mute} autoCapitalize="none" style={input} /></View>
        </>
      )}
      {form.filterOption === 'Setting' && (
        <View style={[styles.filter, { borderColor: theme.line, backgroundColor: theme.bg }]}>
          {fchk('enableCUDA', tx('settings.filterSection.process'))}
          <View>
            {fchk('enableDeinterlace', tx('settings.filterSection.deinterlace'))}
            {fs.enableDeinterlace && (
              <View style={formStyles.indent}><Sel label={tx('settings.filterSection.algorithm')} value={fs.deinterlaceAlgorithm || 'KFM'} opts={AMZ_DEINTERLACE_ALGOS} onChange={(v) => setFlt('deinterlaceAlgorithm', v)} /></View>
            )}
          </View>
          <View>
            {fchk('enableDeblock', tx('settings.filterSection.deblocking'))}
            {fs.enableDeblock && (
              <View style={formStyles.indent}>
                <Cols>
                  <Sel label={tx('settings.filterSection.strength')} value={fs.deblockStrength || 'Medium'} opts={AMZ_DEBLOCK_STRENGTHS} onChange={(v) => setFlt('deblockStrength', v)} />
                  <Num label={tx('settings.filterSection.quality15')} value={fs.deblockQuality ?? 3} onChange={(v) => setFlt('deblockQuality', Math.round(v) || 3)} />
                </Cols>
              </View>
            )}
          </View>
          <View>
            {fchk('enableResize', tx('settings.filterSection.resize'))}
            {fs.enableResize && (
              <View style={formStyles.indent}>
                <Cols>
                  <Num label={tx('settings.filterSection.widthPx')} value={fs.resizeWidth || 1280} onChange={(v) => setFlt('resizeWidth', Math.round(v) || 1280)} />
                  <Num label={tx('settings.filterSection.heightPx')} value={fs.resizeHeight || 720} onChange={(v) => setFlt('resizeHeight', Math.round(v) || 720)} />
                </Cols>
              </View>
            )}
          </View>
          {fchk('enableTemporalNR', tx('settings.filterSection.temporalStabilizationTemporalnr'))}
          {fchk('enableDeband', tx('settings.filterSection.reduceBanding'))}
          {fchk('enableEdgeLevel', tx('settings.filterSection.edgeEnhancementAnime'))}
        </View>
      )}
    </Group>
  );
}

const styles = StyleSheet.create({
  filter: { gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
});
