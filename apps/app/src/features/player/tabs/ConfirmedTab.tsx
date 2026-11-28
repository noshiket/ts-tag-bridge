import { useApi, useRecording } from '@tstag/core/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AutoEncodeRegister } from '../../detail/AutoEncodeRegister';
import { Card } from '../../detail/Card';
import { ConfirmedEditor } from '../../detail/confirmed/ConfirmedEditor';
import { ConfirmedSection } from '../../detail/ConfirmedSection';
import { ParsePreview } from '../../detail/ParsePreview';
import { SegmentsInfo, segmentsOf } from '../../detail/SegmentsInfo';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 再生画面の「確定値」（元の stream_right_tab_confirmed.jsx の ConfirmedTab の動画の方）: 解析のプレビュー、再解析、確定値の編集。
 * 保存した確定値のフォルダ・パスへの移動は、再生画面を離れる時に行う（再生中のファイルを動かさないため。元と同じ）。
 * 音楽は番組表から解析した値ではないので、プレビューと再解析は出さず、曲の情報の編集だけ
 */
export function ConfirmedTab({ videoId, node, onGotoPattern }: { videoId: number; node: string | null; onGotoPattern?: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const q = useQuery({ queryKey: ['videoConfirmed', node ?? '', videoId], queryFn: () => api.videoActions.confirmed(videoId, node) });
  const r = q.data;
  // 通信が無くても、保存した tag.json から置いた分があればそれを出す
  if (q.error && !r) return <T size={12} color="#ef4444" style={styles.pad}>{tx('common.fetchError', { v0: q.error.message })}</T>;
  if (!r) return <T size={12} dim style={styles.pad}>{tx('common.loading2')}</T>;
  const music = r.media_kind === 'audio';
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.pad}>
      {music ? (
        <>
          <T mono size={10} dim style={styles.note}>{tx('player.confirmedTab.savingFixAlsoMoves')}</T>
          <SectionTitle>{tx('player.confirmedTab.trackInfo')}</SectionTitle>
          <Card flat>
            <ConfirmedEditor target={{ kind: 'video', videoId }} confirmed={r.confirmed ?? null} tp={r.parseResult ?? null} parserError={r.parser_error} node={node} compact
              onSaved={() => void q.refetch()} />
          </Card>
        </>
      ) : (
        <>
          <ParsePreview node={node} compact onGotoPattern={onGotoPattern} adoptedIdx={r.episode_idx ?? -1} input={{
            title: r.title ?? '', sid: r.sid ?? null, onid: r.onid ?? null, tsid: r.tsid ?? null, service_name: r.service_name ?? '',
            start_time: r.start_time ?? null, description: r.description ?? '', extended_info: r.extended_info ?? '',
          }} />
          <View style={styles.mt16}>
            <ConfirmedSection target={{ kind: 'video', videoId }} confirmed={r.confirmed ?? null} tp={r.parseResult ?? null} parserError={r.parser_error}
              node={node} onChanged={() => q.refetch()}
              reparse={async (fresh) => (await api.videoActions.reparse(videoId, fresh, node)).sent_request ?? null} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 12 },
  note: { lineHeight: 16, marginBottom: 8 },
  mt16: { marginTop: 16 },
});

/**
 * 録画を再生している時の「確定値」（元の ConfirmedTab の録画の方）: 解析のプレビュー、確定値の編集、自動エンコードの登録、分割の情報。
 * 再解析のボタンは出さない（元と同じ。録画詳細にある）
 */
export function RecConfirmedTab({ dbRecId, node, onGotoPattern }: { dbRecId: number; node: string | null; onGotoPattern?: () => void }) {
  const { t: tx } = useT();
  const q = useRecording(dbRecId, node);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['recordings', node ?? ''] });
  const r = q.data;
  if (q.error) return <T size={12} color="#ef4444" style={styles.pad}>{tx('common.fetchError', { v0: q.error.message })}</T>;
  if (!r) return <T size={12} dim style={styles.pad}>{tx('common.loading2')}</T>;
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.pad}>
      <ParsePreview node={node} compact ctxId={r.id} onGotoPattern={onGotoPattern} input={{
        title: r.title, sid: r.sid, onid: r.onid, tsid: r.tsid, service_name: r.service_name,
        start_time: r.start_time, description: r.description, extended_info: r.extended_info,
      }} />
      <View style={styles.mt16}>
        <SectionTitle>{tx('common.confirmedResult')}</SectionTitle>
        <Card flat>
          <ConfirmedEditor target={{ kind: 'recording', dbRecId }} confirmed={r.confirmed} tp={r.text_parser_result} parserError={r.parser_error} node={node} compact
            onSaved={() => void refresh()} />
        </Card>
      </View>
      <AutoEncodeRegister dbRecId={dbRecId} confirmed={r.confirmed} sid={r.sid} node={node} />
      <SegmentsInfo segments={segmentsOf(r.segments)} dbRecId={dbRecId} node={node} dropError={r.drop_error}
        recordingStart={r.recording_start_time} onChanged={() => void refresh()} />
    </ScrollView>
  );
}
