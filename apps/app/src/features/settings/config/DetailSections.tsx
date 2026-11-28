import { configList, pairRows, rowsToPairs } from '@tstag/core';
import { View } from 'react-native';

import { IntervalRow, PairRows, ToolRow } from './choiceFields';
import { CONFIG_RED, ConfigRow, SecretRow, configStyles as cs } from './configFields';
import type { ConfigEditorState } from './useConfigEditor';
import { WeightNumberRow } from './weightFields';
import { CfgSection } from '../CfgSection';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

type Volume = { host?: string; target?: string };

/** ふだん触らない設定（「詳細設定を表示」で出す）。設定の名前も一緒に出す */
export function DetailSections({ c }: { c: ConfigEditorState }) {
  const { t: tx } = useT();
  const volumes = configList<Volume>(c.cfg, c.dirty, 'volumes');
  return (
    <>
      <CfgSection title={tx('settings.detailSections.connection')} note={tx('common.appliesAfterRestart')}>
        <ConfigRow c={c} label={tx('settings.detailSections.port')} en="port" k="port" type="number" hint={tx('settings.detailSections.portAppConnects')} />
        <ConfigRow c={c} label={tx('settings.detailSections.listenAddress')} en="host" k="host" placeholder="0.0.0.0" hint={tx('settings.detailSections.blankMeansAll0')} />
        <ConfigRow c={c} label="HTTPS" en="https.enabled" k="https.enabled" type="bool" hint={tx('settings.detailSections.putAkebiFrontServe')} />
        <ConfigRow c={c} label={tx('settings.detailSections.internalPort')} en="https.backend_port" k="https.backend_port" type="number" hint={tx('settings.detailSections.portServerListensInternally')} />
        <ConfigRow c={c} label={tx('settings.detailSections.keylessServer')} en="https.keyless_server_url" k="https.keyless_server_url" />
        <ConfigRow c={c} label={tx('settings.detailSections.akebiLocation')} en="https.akebi_path" k="https.akebi_path" placeholder={tx('settings.detailSections.blankUsesBundledOne')} />
        <ConfigRow c={c} label={tx('settings.detailSections.yourOwnCertificate')} en="https.custom_certificate" k="https.custom_certificate" />
        <ConfigRow c={c} label={tx('settings.detailSections.yourOwnPrivateKey')} en="https.custom_private_key" k="https.custom_private_key" />
      </CfgSection>

      <CfgSection title={tx('settings.detailSections.tools')} note={tx('common.appliesAfterRestart')}>
        <ToolRow c={c} label="ffmpeg" k="ffmpeg" />
        <ToolRow c={c} label="ffprobe" k="ffprobe" />
        <ConfigRow c={c} label={tx('settings.detailSections.streamingFfmpeg')} en="streaming.ffmpeg" k="streaming.ffmpeg" placeholder={tx('settings.detailSections.blankUsesOneAbove')} />
        <ConfigRow c={c} label={tx('settings.detailSections.streamingFfprobe')} en="streaming.ffprobe" k="streaming.ffprobe" placeholder={tx('settings.detailSections.blankUsesOneAbove')} />
        <ConfigRow c={c} label={tx('settings.detailSections.stopStreamingAfterS')} en="streaming.max_alive_time" k="streaming.max_alive_time" type="number" hint={tx('settings.detailSections.afterLastViewerLeaves')} />
      </CfgSection>

      <CfgSection title={tx('settings.detailSections.workers')}>
        <IntervalRow c={c} label={tx('settings.detailSections.reservationSync')} k="phase_a_interval" />
        <IntervalRow c={c} label={tx('settings.detailSections.recordingWatcher')} k="phase_b_interval" />
        <IntervalRow c={c} label={tx('settings.detailSections.recordingScan')} k="phase_b_scan_interval" />
        <IntervalRow c={c} label={tx('settings.detailSections.encodeRunner')} k="phase_c_interval" hint={tx('common.appliesAfterRestart')} />
        <ConfigRow c={c} label={tx('settings.detailSections.waitScanWhileMany')} en="phase_b_defer_recordings" k="phase_b_defer_recordings" type="number" hint={tx('settings.detailSections.postponeScanningWhileLeast')} />
        <ConfigRow c={c} label={tx('settings.detailSections.alsoWaitWhileEncoding')} en="phase_b_defer_during_encode" k="phase_b_defer_during_encode" type="bool" hint={tx('settings.detailSections.appliesAfterRestart')} />
      </CfgSection>

      <CfgSection title={tx('settings.detailSections.setLoadNumbers')}>
        <T size={9} dim style={cs.pad}>{tx('settings.detailSections.cmAnalysisLoadUnder')}</T>
        <WeightNumberRow c={c} label={tx('settings.detailSections.cmAnalysisParallelism')} kind="cmcut" p="workers" />
        <WeightNumberRow c={c} label={tx('settings.detailSections.cmAnalysisNiceness')} kind="cmcut" p="nice" hint={tx('settings.detailSections.019HigherYields')} />
        <WeightNumberRow c={c} label={tx('settings.detailSections.loadReduceCmParallelism')} kind="cmcut" p="max_load" hint={tx('settings.detailSections.reduceParallelismWhenLoad')} />
        <WeightNumberRow c={c} label={tx('settings.detailSections.audioAnalysisNiceness')} kind="audio_sync" p="nice" hint={tx('settings.detailSections.019HigherYields')} />
        <WeightNumberRow c={c} label={tx('settings.detailSections.loadHoldAudioAnalysis')} kind="audio_sync" p="max_load" hint={tx('settings.detailSections.waitWhileLoadAverage')} />
      </CfgSection>

      <CfgSection title={tx('settings.detailSections.logsCleanup')}>
        <ConfigRow c={c} label={tx('settings.detailSections.dataFolder')} en="data_dir" k="data_dir" placeholder={String(c.val('data_dir_in_use') ?? 'server/data')}
          hint={tx('settings.detailSections.blankMeansServerDb')} />
        <ConfigRow c={c} label={tx('settings.detailSections.encodeHistoryLimit')} en="encode_history_limit" k="encode_history_limit" type="number" hint={tx('settings.detailSections.0MeansUnlimited')} />
        <ConfigRow c={c} label={tx('settings.detailSections.daysKeepProgramsRecordings')} en="program_retention_days" k="program_retention_days" type="number" />
        <ConfigRow c={c} label={tx('settings.detailSections.dropInvestigationLog')} en="drop_debug" k="drop_debug" type="bool" hint={tx('settings.detailSections.onlyWhenInvestigatingProblems')} />
        <ConfigRow c={c} label={tx('settings.detailSections.alsoWriteDebugLogs')} en="log_debug" k="log_debug" type="bool" hint={tx('settings.detailSections.offLogsOnlyEvents')} />
        <ConfigRow c={c} label={tx('settings.detailSections.alsoWriteLogsFile')} en="log_file" k="log_file" type="bool" hint={tx('settings.detailSections.keptAcrossRestartsUp')} />
        <ConfigRow c={c} label={tx('settings.detailSections.logFileLocation')} en="log_file_path" k="log_file_path" placeholder="server/data/logs/server.log" hint={tx('settings.detailSections.blankUsesLocationPath')} />
      </CfgSection>

      <CfgSection title={tx('settings.detailSections.parserValuesPathMapping')}>
        <View style={cs.pad}>
          <T size={11} w={700} style={cs.mb2}>{tx('settings.detailSections.valuesPassedParser')}</T>
          <T size={9} dim style={cs.mb4}>{tx('settings.detailSections.valuesUsableNamePattern')}</T>
          <PairRows rows={pairRows(c.val('text_parser_context'))} onChange={(r) => c.set('text_parser_context', rowsToPairs(r))}
            clean={(r) => pairRows(rowsToPairs(r))}
            left={tx('settings.federation.name')} right={tx('settings.federation.value')} sep="=" changed={'text_parser_context' in c.dirty} />
        </View>
        <View style={[cs.pad, cs.bt]}>
          <T size={11} w={700} style={cs.mb2}>{tx('settings.detailSections.serversPathMapping')}</T>
          <T size={9} dim style={cs.mb4}>{tx('settings.detailSections.onlyWhenRunningServer')}</T>
          <PairRows rows={volumes.map((v) => [v.host ?? '', v.target ?? ''])}
            onChange={(r) => c.set('volumes', r.map(([host, target]) => ({ host, target })))}
            clean={(r) => r.filter(([h, t]) => h || t)}
            left={tx('settings.federation.host')} right={tx('settings.federation.container')} sep="↔" changed={'volumes' in c.dirty} />
        </View>
      </CfgSection>

      <CfgSection title={tx('common.sign')} note={tx('common.appliesAfterRestart')}>
        <SecretRow c={c} label={tx('settings.detailSections.signKey')} en="jwt_secret" k="jwt_secret"
          hint={tx('settings.detailSections.keyServerSignsSign')} />
        <T mono size={9} color={CONFIG_RED} style={{ paddingHorizontal: 13, paddingBottom: 10, paddingTop: 8, lineHeight: 14 }}>{tx('settings.detailSections.savingChangeRestartingSigns')}</T>
      </CfgSection>
    </>
  );
}
