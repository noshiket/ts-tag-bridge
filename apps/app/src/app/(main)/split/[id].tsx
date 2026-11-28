import { buildSplitSource } from '@tstag/core';
import { useRecording } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SplitScreen } from '../../../features/split/SplitScreen';
import { TabBar } from '../../../features/shell/TabBar';
import { useViewNode } from '../../../lib/state/viewNode';
import { T } from '../../../ui/parts/T';
import { TopBar } from '../../../ui/parts/TopBar';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 録画の分割（元の split.jsx の SplitScreen）。番号は録画の db_rec_id。開き直しても録画を引き直して続ける */
export default function SplitRoute() {
  const { t: tx } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const dbRecId = Number(id);
  const { theme } = useTheme();
  const { viewNode } = useViewNode();
  const qc = useQueryClient();
  const q = useRecording(dbRecId, viewNode);
  const src = useMemo(() => (q.data ? buildSplitSource(q.data) : null), [q.data]);
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/recording/[id]', params: { id: dbRecId } }));
  const top = (
    <TopBar title={tx('common.split')} onBack={back} />
  );
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: theme.bg }]}>
      {src ? (
        // 反映したら録画詳細へ戻り、一覧と詳細を取り直す（元と同じ）
        <SplitScreen src={src} node={viewNode} topBar={top}
          onDone={() => { void qc.invalidateQueries({ queryKey: ['recordings', viewNode ?? ''] }); back(); }} />
      ) : (
        <>
          {top}
          <T mono size={13} dim style={styles.msg}>{q.error ? q.error.message : tx('common.loading')}</T>
        </>
      )}
      {/* 下のタブ（再生中ならミニプレイヤーの帯も）。他の詳細の画面と同じ */}
      <TabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  msg: { textAlign: 'center', padding: 40 },
});
