import { View } from 'react-native';

import { MiniHeightRow } from './MiniHeightRow';
import { WeightRow } from './weightFields';
import { EncoderChoice, Fold, PresetList, VolumeRows } from './serverCardFields';
import { ConfigRow, PathList, TestButton, configStyles as cs } from './configFields';
import type { ConfigEditorState } from './useConfigEditor';
import { ArrayCardEditor } from '../ArrayCardEditor';
import { CfgSection } from '../CfgSection';
import { PathVarsHelp } from '../../patterns/common/PathVarsHelp';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 基本の設定（ふだん決める物だけ）: 録画とエンコードのサーバー、出力と作業の場所、解析の重さ、ライブ配信。
 * ふだん触らない物は DetailSections（「詳細設定を表示」で出す）
 */
export function BasicSections({ c }: { c: ConfigEditorState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  // カードの1つの項目だけ変える
  const setItem = (key: string, list: Record<string, unknown>[], i: number, field: string, v: unknown) =>
    c.set(key, list.map((x, j) => (j === i ? { ...x, [field]: v } : x)));
  return (
    <>
      <CfgSection title={tx('settings.basicSections.recordingEncodingServers')} note={tx('common.appliesAfterRestart')} defaultOpen>
        <T size={10} dim style={cs.pad}>{tx('settings.basicSections.recordsAmatsukazeEncodesUse')}</T>
        <T size={11} w={700} style={cs.pad}>EDCB</T>
        <ArrayCardEditor items={c.edcbServers} onChange={(a) => c.set('edcb_servers', a)}
          fields={[{ key: 'name', label: tx('library.musicSort.name') }, { key: 'url', label: 'URL', placeholder: 'http://host:5510' }, { key: 'tcp_url', label: tx('settings.basicSections.tcpUrl'), placeholder: 'tcp://host:4510' }]}
          newItem={{ name: '', url: '', tcp_url: '', encode: [], volumes: [] }}
          renderExtra={(it, i) => (
            <>
              <TestButton c={c} k={`edcb-${it.url}`} body={{ type: 'edcb', url: it.url }} />
              <EncoderChoice value={it.encode} servers={c.amzServers.map((s) => String(s.name ?? ''))} onChange={(v) => setItem('edcb_servers', c.edcbServers, i, 'encode', v)} />
              <Fold title={tx('common.pathMapping')}><VolumeRows value={it.volumes} who="EDCB" onChange={(v) => setItem('edcb_servers', c.edcbServers, i, 'volumes', v)} /></Fold>
            </>
          )} />
        <T size={11} w={700} style={cs.pad}>Amatsukaze</T>
        <ArrayCardEditor items={c.amzServers} onChange={(a) => c.set('amatsukaze_servers', a)}
          fields={[{ key: 'name', label: tx('library.musicSort.name') }, { key: 'url', label: 'URL', placeholder: 'http://host:32769' }]}
          newItem={{ name: '', url: '', volumes: [], encode_preset: [] }}
          renderExtra={(it, i) => (
            <>
              <TestButton c={c} k={`amz-${it.url}`} body={{ type: 'amatsukaze', url: it.url }} />
              <Fold title={tx('common.encoding')}><PresetList value={it.encode_preset} url={String(it.url ?? '')} onChange={(v) => setItem('amatsukaze_servers', c.amzServers, i, 'encode_preset', v)} /></Fold>
              <Fold title={tx('common.pathMapping')}><VolumeRows value={it.volumes} who="Amatsukaze" onChange={(v) => setItem('amatsukaze_servers', c.amzServers, i, 'volumes', v)} /></Fold>
            </>
          )} />
      </CfgSection>

      <CfgSection title={tx('settings.basicSections.storageWorkingFolders')} defaultOpen>
        <View style={[cs.pad, cs.bb, { borderBottomColor: theme.line }]}>
          <T size={11} w={700} style={cs.mb2}>{tx('settings.basicSections.whereEncodedVideosSaved')}</T>
          <T size={9} dim style={cs.mb4}>{tx('settings.basicSections.destinationsChoosePerRecording')}</T>
          <PathList c={c} list={c.encodeDirs} setList={(l) => c.set('encode_dir_list', l)} />
        </View>
        <View style={[cs.pad, cs.bb, { borderBottomColor: theme.line }]}>
          <T size={11} w={700} style={cs.mb2}>{tx('settings.basicSections.temporaryWorkingFolders')}</T>
          <T size={9} dim style={cs.mb4}>{tx('settings.basicSections.usedTopBottomMoves')}</T>
          <PathList c={c} list={c.tmpBases} setList={(l) => c.set('tmp_base_list', l)} placeholder="/home/.../tmp" ordered />
        </View>
        <ConfigRow c={c} label={tx('settings.basicSections.fileNaming')} en="output_path" k="output_path" hint="{$folder}・{$title} などで組み立てる。新しいパターンの setPath にもこれが入る" />
        <View style={[cs.pad, cs.bb, { borderBottomColor: theme.line }]}>
          <PathVarsHelp template={String(c.val('output_path') ?? '')} onInsert={(x) => c.set('output_path', String(c.val('output_path') ?? '') + x)} />
        </View>
      </CfgSection>

      <CfgSection title={tx('settings.basicSections.behavior')} defaultOpen>
        <ConfigRow c={c} label={tx('settings.basicSections.skipDuplicateReservations')} en="auto_skip_duplicates" k="auto_skip_duplicates" type="bool"
          hint={tx('settings.basicSections.dontRecordIfParsed')} />
        <WeightRow c={c} label={tx('settings.basicSections.cmAnalysisLoad')} kind="cmcut" hint={tx('settings.basicSections.runsAutomaticallyWhenRecording')} />
        <WeightRow c={c} label={tx('settings.basicSections.audioAnalysisLoad')} kind="audio_sync" hint={tx('settings.basicSections.captionImportMusicImport')} />
        <MiniHeightRow c={c} />
      </CfgSection>

      <CfgSection title={tx('settings.basicSections.liveStreaming')} note={tx('common.appliesAfterRestart')}>
        <ConfigRow c={c} label={tx('settings.basicSections.use')} en="streaming.edcb_server" k="streaming.edcb_server" type="select"
          options={[['', tx('settings.basicSections.none')], ...c.edcbServers.map((s): [string, string] => [String(s.name ?? ''), String(s.name ?? '')])]} />
        <ConfigRow c={c} label={tx('common.encoder')} en="streaming.encoder" k="streaming.encoder" type="select"
          options={[['FFmpeg', tx('settings.basicSections.ffmpeg')], ['QSVEncC', tx('settings.basicSections.nccIntel')], ['NVEncC', tx('settings.basicSections.ncc')], ['VCEEncC', tx('settings.basicSections.ncc2')]]} />
      </CfgSection>
    </>
  );
}
