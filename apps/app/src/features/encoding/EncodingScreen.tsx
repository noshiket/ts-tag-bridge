import type { EncodeRow } from '@tstag/core';
import { useEncodes } from '@tstag/core/react';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { JobDetails } from './JobDetails';
import { JobHeader } from './JobHeader';
import { JobMenuSheets } from './JobMenuSheets';
import { JobRetry } from './JobRetry';
import { JobLiveLog, JobParallel } from './JobRunningSections';
import { JobTot } from './JobTot';
import { JOB_GREEN, JOB_RED } from './jobShared';
import { EncodeProgress } from './Progress';
import { SourceAndResult } from './SourceAndResult';
import { useJobActions } from './useJobActions';
import { useViewNode } from '../../lib/state/viewNode';
import { More } from '../../ui/parts/Icons';
import { T } from '../../ui/parts/T';
import { IconButton, TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * エンコード進捗（元の queue.jsx の EncodingScreen）。録画結果のエンコードのカードから開く。
 * 指定の番号が一覧に無ければ、実行中 → エラーの順で代わりを出す（元と同じ）
 */
export function EncodingScreen({ encId }: { encId: number }) {
  const { t: tx } = useT();
  const { viewNode: node } = useViewNode();
  const encodes = useEncodes(node);
  const list = encodes.data ?? [];
  const e = list.find((x) => x.id === encId) ?? list.find((x) => x.status === 'running') ?? list.find((x) => x.status === 'error');
  const back = () => (router.canGoBack() ? router.back() : router.replace('/recresult'));
  if (!e) {
    return (
      <>
        <TopBar title={tx('encoding.encodingScreen.encodeProgress')} onBack={back} />
        <T size={13} dim style={styles.empty}>{!encodes.data ? (encodes.error ? encodes.error.message : tx('common.loading')) : tx('encoding.encodingScreen.noJobEncoding')}</T>
      </>
    );
  }
  return <Job key={e.id} e={e} list={list} node={node} back={back} />;
}

/**
 * 1件の仕事: 見出し・詳細・やり直し・進み具合、走っている間はログと次の仕事、終わったら TOT、
 * 一番下に録画元とエンコード結果のカード。上端の「…」は make_DB・スキップ・削除
 */
function Job({ e, list, node, back }: { e: EncodeRow; list: EncodeRow[]; node: string | null; back: () => void }) {
  const { t: tx } = useT();
  const { theme, progressStyle } = useTheme();
  const a = useJobActions(e, node);
  const running = e.status === 'running';
  return (
    <>
      <TopBar title={tx('encoding.encodingScreen.encodeProgress')} onBack={back} right={
        <View style={styles.row8}>
          {!!a.msg && <T mono size={11} color={a.msg.startsWith(tx('state.rec.encode_error')) ? JOB_RED : a.msg.includes(tx('state.rec.encode_finish')) ? JOB_GREEN : theme.mute}>{a.msg}</T>}
          <IconButton onPress={() => a.setMoreOpen(true)} title={tx('common.other')}><More c={theme.ink} /></IconButton>
        </View>
      } />
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <JobHeader e={e} node={node} />
        <JobDetails e={e} node={node} refresh={a.refresh} />
        <JobRetry e={e} node={node} refresh={a.refresh} />
        <EncodeProgress e={e} style={progressStyle} />
        {running && <JobLiveLog e={e} node={node} />}
        {e.status === 'done' && <JobTot e={e} />}
        {running && <JobParallel list={list} node={node} />}
        {/* 録画元とエンコード結果のカードは、この仕事の情報の後ろ（一番下）に */}
        <SourceAndResult e={e} node={node} />
      </ScrollView>
      <JobMenuSheets e={e} a={a} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 100 },
  empty: { textAlign: 'center', padding: 60 },
  row8: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
