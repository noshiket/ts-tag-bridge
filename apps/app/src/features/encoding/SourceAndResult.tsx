import { videoContextLabel, type EncodeRow, type Recording } from '@tstag/core';
import { useApi, useRecording, useRemoveRecording } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { VideoCard } from '../library/VideoCard';
import { RecDeleteSheet } from '../recresult/RecDeleteSheet';
import { RecordingCard } from '../recresult/RecordingCard';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { useT } from '../../ui/i18n/I18n';

/** 見出しを付けるなら見出しの下に（カードが無い時は見出しも出さない） */
function Section({ title, children }: { title?: string; children: ReactNode }) {
  if (!title) return <>{children}</>;
  return <View style={styles.section}><SectionTitle>{title}</SectionTitle>{children}</View>;
}

/** その仕事の録画元の録画カード（消す操作つき）。録画が無ければ出さない */
function SourceCard({ e, node, onOpen, title }: { e: EncodeRow; node: string | null; onOpen: () => void; title?: string }) {
  const rec = useRecording(e.recordingId ?? 0, node, e.recordingId != null);
  const remove = useRemoveRecording(node);
  const [deleting, setDeleting] = useState<Recording | null>(null);
  if (!rec.data) return null;
  return (
    <Section title={title}>
      <RecordingCard r={rec.data} node={node} onDelete={() => setDeleting(rec.data!)} onOpen={onOpen} />
      <RecDeleteSheet r={deleting} onClose={() => setDeleting(null)} onDelete={(r, keepEdcb) => remove.mutate({ r, keepEdcb })} />
    </Section>
  );
}

/** その仕事が作った（アドオンなら手を入れる）動画のビデオカード。まだ無ければ出さない */
function ResultCard({ e, node, title }: { e: EncodeRow; node: string | null; title?: string }) {
  const api = useApi();
  const video = useQuery({
    queryKey: ['videoCards', node ?? '', e.videoId],
    queryFn: async () => (await api.library.videoCards([e.videoId!], node))[0] ?? null,
    enabled: e.videoId != null,
  });
  const v = video.data;
  if (!v) return null;
  return (
    <Section title={title}>
      <VideoCard video={v} node={node} albumName={v.album_name ?? undefined}
        contextLabel={videoContextLabel(v)}
        onPlay={() => router.push({ pathname: '/watch/[id]', params: node ? { id: v.id, node } : { id: v.id } })} />
    </Section>
  );
}

/**
 * エンコード進捗の「録画元」と「エンコード結果」を、録画結果の録画カード・ライブラリのビデオカードで出す
 * （どの録画から何ができたかを、見慣れたカードで見て、そのまま録画詳細・再生・録画の操作へ行ける）。
 * 見つからない方は出さない（録画を消した後・まだできていない間）
 */
export function SourceAndResult({ e, node }: { e: EncodeRow; node: string | null }) {
  const { t: tx } = useT();
  return (
    <>
      <SourceCard e={e} node={node} title={tx('encoding.sourceAndResult.source')} onOpen={() => router.push({ pathname: '/recording/[id]', params: { id: e.recordingId! } })} />
      <ResultCard e={e} node={node} title={tx('encoding.sourceAndResult.result')} />
    </>
  );
}

/** 待っている仕事を録画カードで（アドオンの仕事は録画が無いので、手を入れる動画のビデオカード）。押すとその仕事の進捗へ */
export function QueuedJobCard({ e, node }: { e: EncodeRow; node: string | null }) {
  if (e.recordingId == null) return <ResultCard e={e} node={node} />;
  return <SourceCard e={e} node={node} onOpen={() => router.push({ pathname: '/encoding/[id]', params: { id: e.id } })} />;
}

const styles = StyleSheet.create({
  section: { marginTop: 16, marginBottom: 6 },
});
