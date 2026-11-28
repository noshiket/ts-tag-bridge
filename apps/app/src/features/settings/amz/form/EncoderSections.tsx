import { AMZ_DECODERS, AMZ_ENCODERS, AMZ_ENCODER_OPT_KEY, AMZ_OUTPUT_FORMATS } from '@tstag/core';
import { TextInput, View } from 'react-native';

import { Cols, Group, Label, Num, Sel, formStyles } from './formParts';
import type { ProfileFields } from './useProfileFields';
import { useT } from '../../../../ui/i18n/I18n';

/** エンコーダ（種類・並列・追加オプション）・デコーダ・出力（形式・マスク） */
export function EncoderSections({ f }: { f: ProfileFields }) {
  const { t: tx } = useT();
  const { form, set, str, chk, input } = f;
  const optKey = AMZ_ENCODER_OPT_KEY[form.encoderType ?? ''] ?? 'qsvEncOption';
  return (
    <>
      <Group title={tx('common.encoder')}>
        <Cols>
          <Sel label="encoderType" value={form.encoderType || 'QSVEnc'} opts={AMZ_ENCODERS} onChange={(v) => set('encoderType', v)} />
          <Num label="encoderParallel" value={form.encoderParallel} onChange={(v) => set('encoderParallel', Math.round(v) || 1)} />
        </Cols>
        <View>
          <Label>{optKey}</Label>
          <TextInput value={str(optKey)} onChangeText={(v) => set(optKey, v)} multiline placeholder={tx('settings.encoderSections.extraEncoderOptions')} placeholderTextColor={f.mute}
            autoCapitalize="none" autoCorrect={false} style={[input, formStyles.area3]} />
        </View>
        {chk('muxerAddEncoderCmd', tx('settings.encoderSections.recordExtraOptionsContainer'))}
      </Group>

      <Group title={tx('settings.encoderSections.decoder')}>
        <Cols>
          <Sel label="MPEG2" value={str('mpeg2Decoder') || 'Default'} opts={AMZ_DECODERS} onChange={(v) => set('mpeg2Decoder', v)} />
          <Sel label="H264" value={str('h264Deocder') || 'Default'} opts={AMZ_DECODERS} onChange={(v) => set('h264Deocder', v)} />
          <Sel label="HEVC" value={str('hevcDecoder') || 'Default'} opts={AMZ_DECODERS} onChange={(v) => set('hevcDecoder', v)} />
        </Cols>
      </Group>

      <Group title={tx('common.output')}>
        <Cols>
          <Sel label="outputFormat" value={form.outputFormat || 'MKV'} opts={AMZ_OUTPUT_FORMATS} onChange={(v) => set('outputFormat', v)} />
          <Num label="outputMask" value={Number(form.outputMask ?? 2)} onChange={(v) => set('outputMask', Math.round(v) || 0)} />
        </Cols>
        {form.outputFormat === 'MP4' && chk('useMKVWhenSubExists', tx('settings.encoderSections.outputWhenThereCaptions'))}
        {form.outputFormat === 'TSREPLACE' && chk('tsreplaceRemoveTypeD', tx('settings.encoderSections.removeDataBroadcasting'))}
        {chk('splitSub', tx('settings.encoderSections.dontMergeNonMain'))}
      </Group>
    </>
  );
}
