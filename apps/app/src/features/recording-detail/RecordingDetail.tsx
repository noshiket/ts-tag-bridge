import type { RecordingDetail as Rec } from '@tstag/core';
import { useApi, useRemoveRecording } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { QueueActions } from './QueueActions';
import { REC_PROTECT, REC_RED, REC_RED_INK } from './recColors';
import { RecordingHeaderCard } from './RecordingHeaderCard';
import { AutoEncodeRegister } from '../detail/AutoEncodeRegister';
import { ConfirmedSection } from '../detail/ConfirmedSection';
import { DuplicateVideos } from '../detail/DuplicateVideos';
import { EncodeSettings } from '../detail/EncodeSettings';
import { ParsePreview } from '../detail/ParsePreview';
import { ProgramInfo } from '../detail/ProgramInfo';
import { SegmentsInfo, segmentsOf } from '../detail/SegmentsInfo';
import { ShoboiInfoPanel } from '../detail/ShoboiInfoPanel';
import { RecDeleteSheet } from '../recresult/RecDeleteSheet';
import { RecMoreSheet } from '../recresult/RecMoreSheet';
import { Lock, More, Trash } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { T } from '../../ui/parts/T';
import { IconButton, TopBar } from '../../ui/parts/TopBar';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/**
 * 録画詳細の中身（元の detail_rec.jsx）: 見出しのカード・しょぼいカレンダー・番組情報・解析の試し・確定値・
 * 自動エンコード・区間・エンコード設定・キュー・保護と削除・重複する動画。上端の「…」はその他の操作
 */
export function RecordingDetailView({ r, node, back }: { r: Rec; node: string | null; back: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const qc = useQueryClient();
  const { theme, accent } = useTheme();
  const dbRecId = r.db_rec_id!;
  const remove = useRemoveRecording(node);
  const [deleting, setDeleting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // 「…」の操作の結果（見出しの横に出す）
  const [msg, setMsg] = useState('');
  const showMsg = (m: string, ms?: number) => { setMsg(m); if (ms) setTimeout(() => setMsg((cur) => (cur === m ? '' : cur)), ms); };
  const refresh = () => qc.invalidateQueries({ queryKey: ['recordings', node ?? ''] });

  return (
    <>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <TopBar title={tx('recordingDetail.recordingDetail.recordingDetails')} onBack={back} right={
          <View style={styles.topRight}>
            {!!msg && <T mono size={11} numberOfLines={2} style={styles.msg}
              color={/^(スキャン完了|保存:)/.test(msg) ? oklch(0.6, 0.2, 145) : msg.startsWith('失敗') ? REC_RED : theme.mute}>{msg}</T>}
            <IconButton title={tx('common.other')} onPress={() => setMoreOpen(true)}><More c={theme.ink} /></IconButton>
          </View>
        } />
        <View style={styles.pad}>
          <RecordingHeaderCard r={r} node={node} />
          <ShoboiInfoPanel info={r.shoboi_info} />
          <ProgramInfo description={r.description} extendedInfo={r.extended_info} genre={r.eit_genre} />
          <ParsePreview node={node} ctxId={r.id} input={{
            title: r.title, sid: r.sid, onid: r.onid, tsid: r.tsid, service_name: r.service_name,
            start_time: r.start_time, description: r.description, extended_info: r.extended_info,
          }} />
          <ConfirmedSection target={{ kind: 'recording', dbRecId }} confirmed={r.confirmed} tp={r.text_parser_result}
            parserError={r.parser_error} node={node} onChanged={refresh}
            reparse={async (fresh) => (await api.recordings.reparse(dbRecId, fresh, node)).text_parser_context ?? null} />
          <AutoEncodeRegister dbRecId={dbRecId} confirmed={r.confirmed} sid={r.sid} node={node} />
          <SegmentsInfo segments={segmentsOf(r.segments)} dbRecId={dbRecId} node={node} dropError={r.drop_error}
            recordingStart={r.recording_start_time} onChanged={() => void refresh()}
            right={(
              <Pressable onPress={() => router.push({ pathname: '/split/[id]', params: { id: dbRecId } })}
                style={[styles.toSplit, { backgroundColor: accent.primary, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
                <T mono size={10} color="#fff">{tx('recordingDetail.recordingDetail.split')}</T>
              </Pressable>
            )} />
          <EncodeSettings dbRecId={dbRecId} saved={r.to_encode_info} node={node} />
          <QueueActions r={r} node={node} onChanged={refresh} />
          <View style={styles.row2}>
            <Pressable onPress={() => void api.recordings.setProtect(r.id, !r.protect_flag, node).then(refresh)}
              style={[styles.half, { borderColor: theme.frame, backgroundColor: r.protect_flag ? REC_PROTECT : theme.surface }]}>
              <Lock s={13} c={r.protect_flag ? '#fff' : theme.ink} />
              <T size={12} w={800} color={r.protect_flag ? '#fff' : theme.ink}>{r.protect_flag ? 'PROTECT ON' : 'protect'}</T>
            </Pressable>
            <Pressable onPress={() => setDeleting(true)} style={[styles.half, { borderColor: REC_RED }]}>
              <Trash s={13} c={REC_RED_INK} /><T size={12} w={800} color={REC_RED_INK}>{tx('reservations.list.sheet.delete')}</T>
            </Pressable>
          </View>
          <DuplicateVideos list={r.duplicate_info ?? []} node={node} />
        </View>
      </ScrollView>
      <RecMoreSheet r={r} node={node} open={moreOpen} onClose={() => setMoreOpen(false)} onMessage={showMsg} onChanged={() => void refresh()} />
      <RecDeleteSheet r={deleting ? r : null} onClose={() => setDeleting(false)}
        onDelete={(x, keepEdcb) => remove.mutate({ r: x, keepEdcb }, { onSuccess: back })} />
    </>
  );
}

const styles = StyleSheet.create({
  toSplit: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, marginBottom: 8 },
  content: { paddingBottom: 40 },
  pad: { paddingHorizontal: 18 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  msg: { flexShrink: 1, maxWidth: 180 },
  row2: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 8 },
  half: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 11, borderWidth: 1.5 },
});
