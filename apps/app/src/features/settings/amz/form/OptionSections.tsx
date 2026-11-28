import { AMZ_AUDIO_ENCODERS, AMZ_AUDIO_OPT_KEY } from '@tstag/core';
import { StyleSheet, TextInput, View } from 'react-native';

import { Cols, Group, Label, Num, NumBox, Sel, formStyles } from './formParts';
import type { ProfileFields } from './useProfileFields';
import { T } from '../../../../ui/parts/T';
import { useT } from '../../../../ui/i18n/I18n';

/** ビットレート・音声エンコード・チャプター/ロゴ/字幕・その他・詳細（バッファと PMT 更新時の CM 判定） */
export function OptionSections({ f }: { f: ProfileFields }) {
  const { t: tx } = useT();
  const { form, set, setBr, str, chk, input } = f;
  const audKey = AMZ_AUDIO_OPT_KEY[String(form.audioEncoderType)] ?? 'neroAacOption';
  return (
    <>
      <Group title={tx('settings.optionSections.bitrate')}>
        <Cols>
          <Num label={tx('settings.optionSections.bitratecmCmFactor')} value={Number(form.bitrateCM ?? 0.5)} float onChange={(v) => set('bitrateCM', v)} />
          <Num label="cmQualityOffset" value={Number(form.cmQualityOffset ?? 0)} float onChange={(v) => set('cmQualityOffset', v)} />
        </Cols>
        {chk('twoPass', tx('settings.optionSections.2PassEncoding'))}
        {chk('autoBuffer', tx('settings.optionSections.automaticBitrateAutobuffer'))}
        {!!form.autoBuffer && (
          <View style={formStyles.indent}>
            <Cols>
              <Num label={tx('settings.optionSections.bitrateCoefficient')} value={form.bitrate.a} float onChange={(v) => setBr('a', v)} />
              <Num label="bitrate.b (kbps)" value={form.bitrate.b} onChange={(v) => setBr('b', Math.round(v))} />
              <Num label={tx('settings.optionSections.bitrateH264Coefficient')} value={form.bitrate.h264} float onChange={(v) => setBr('h264', v)} />
            </Cols>
          </View>
        )}
      </Group>

      <Group title={tx('settings.optionSections.audioEncoding')}>
        {chk('enableAudioEncode', tx('settings.optionSections.encodeAudio'))}
        {!!form.enableAudioEncode && (
          <>
            <Cols>
              <Sel label="audioEncoderType" value={str('audioEncoderType') || 'NeroAac'} opts={AMZ_AUDIO_ENCODERS} onChange={(v) => set('audioEncoderType', v)} />
              <Num label={tx('settings.optionSections.bitrateKbps')} value={Number(form.audioBitrateInKbps || 128)} onChange={(v) => set('audioBitrateInKbps', Math.round(v) || 0)} />
            </Cols>
            {chk('enableAudioBitrate', tx('settings.optionSections.specifyBitrate'))}
            <View>
              <Label>{audKey}</Label>
              <TextInput value={str(audKey)} onChangeText={(v) => set(audKey, v)} multiline placeholder={tx('settings.optionSections.extraAudioEncoderOptions')} placeholderTextColor={f.mute}
                autoCapitalize="none" autoCorrect={false} style={[input, formStyles.area2]} />
            </View>
          </>
        )}
      </Group>

      <Group title={tx('settings.optionSections.chaptersLogosCaptions')} gap={6}>
        {chk('disableChapter', tx('settings.optionSections.disableChaptersCmAnalysis'))}
        {chk('outputChapter', tx('settings.optionSections.outputChaptersSeparateFile'), !!form.disableChapter)}
        {chk('ignoreNoLogo', tx('settings.optionSections.continueEvenIfLogo'))}
        {chk('noDelogo', tx('settings.optionSections.dontRemoveLogos'))}
        {chk('looseLogoDetection', tx('settings.optionSections.lowerLogoDetectionThreshold'))}
        {chk('ignoreNoDrcsMap', tx('settings.optionSections.ignoreGlyphsNotMap'))}
        {chk('disableSubs', tx('settings.optionSections.disableCaptions'))}
        {!form.disableSubs && chk('enableWebVTT', tx('settings.optionSections.generateWebCaptions'))}
        {chk('enableNicoJK', tx('settings.optionSections.enableNiconicoJikkyoComments'))}
      </Group>

      <Group title={tx('common.other')} gap={6}>
        {chk('disableMoveInputFile', tx('settings.optionSections.dontMoveInputFile'))}
        {chk('noRemoveTmp', tx('settings.optionSections.keepTempFiles'))}
        {chk('disableLogFile', tx('settings.optionSections.dontCreateLogFile'))}
        {chk('saveProfileText', tx('settings.optionSections.saveProfileInfoText'))}
        {chk('ignoreEncodeAffinity', tx('settings.optionSections.ignoreAffinity'))}
        {chk('disableHashCheck', tx('settings.optionSections.disableHashCheckOver'))}
      </Group>

      <Group title={tx('library.video.details')}>
        <Num label="numEncodeBufferFrames (1-54)" value={form.numEncodeBufferFrames || 16} onChange={(v) => set('numEncodeBufferFrames', Math.round(v) || 16)} />
        <View style={styles.pmt}>
          {chk('enablePmtCut', tx('settings.optionSections.cmDetectionUpdate'))}
          {!!form.enablePmtCut && (
            <>
              <T size={10} dim>{tx('common.start')}</T>
              <NumBox value={Number(form.pmtCutHeadRate || 0)} onChange={(v) => set('pmtCutHeadRate', Math.round(v) || 0)} />
              <T size={10} dim>{tx('settings.optionSections.end')}</T>
              <NumBox value={Number(form.pmtCutTailRate || 0)} onChange={(v) => set('pmtCutTailRate', Math.round(v) || 0)} />
              <T size={10} dim>%</T>
            </>
          )}
        </View>
      </Group>
    </>
  );
}

const styles = StyleSheet.create({
  pmt: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
