import type { Capture } from '@tstag/core';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { CaptureGrid } from '../../library/CaptureGrid';
import { Switch } from '../../../ui/inputs/Switch';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

export interface CaptureOptions { includeComment: boolean; includeCaption: boolean }
export type CaptureResult = { ok: true; file: string } | { ok: false; error: string };

/**
 * 再生画面の「キャプチャ」: 今のコマを撮る（コメント・字幕を含めるか選べる）と、このアルバムのキャプチャ一覧。
 * iOS は小窓へ送っているコマから撮る（部品を入れる前に作ったアプリでは撮れない）
 */
export function CaptureTab({ captures, albumId, node, onCapture, onPlayAt, canCapture: canCaptureProp }: {
  captures: Capture[] | undefined;
  albumId: number | null | undefined;
  node: string | null;
  onCapture: (o: CaptureOptions) => Promise<CaptureResult>;
  onPlayAt: (c: Capture) => void;
  /** 撮れるか（ライブは iOS でも WebView の中で撮れる）。省略時は Web だけ */
  canCapture?: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [includeComment, setIncludeComment] = useState(true);
  const [includeCaption, setIncludeCaption] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canCapture = canCaptureProp ?? Platform.OS === 'web';

  const capture = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    const r = await onCapture({ includeComment, includeCaption });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: tx('player.captureTab.saved', { v0: r.file }) } : { ok: false, text: r.error });
  };

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.wrap}>
      {canCapture ? (
        <>
          <View style={styles.row}><T size={13}>{tx('player.captureTab.includeComments')}</T><Switch label={tx('player.captureTab.includeComments')} on={includeComment} onChange={() => setIncludeComment((v) => !v)} /></View>
          <View style={styles.row}><T size={13}>{tx('player.captureTab.includeCaptions')}</T><Switch label={tx('player.captureTab.includeCaptions')} on={includeCaption} onChange={() => setIncludeCaption((v) => !v)} /></View>
          <Pressable onPress={capture} disabled={busy} style={[styles.btn, { backgroundColor: accent.primary, opacity: busy ? 0.6 : 1 }]}>
            <T size={14} w={700} color="#fff">{busy ? tx('common.saving2') : tx('player.captureTab.capture')}</T>
          </Pressable>
          {msg && <T size={12} color={msg.ok ? '#10b981' : '#ef4444'}>{msg.text}</T>}
        </>
      ) : (
        <T size={11} dim>{tx('player.captureTab.appCantTakeCaptures')}</T>
      )}
      {albumId != null && (
        <>
          <T mono size={11} dim style={[styles.section, { borderTopColor: theme.line }]}>
            {tx('player.captureTab.capturesAlbum', { v0: captures?.length ?? 0 })}
          </T>
          {captures ? <CaptureGrid captures={captures} node={node} albumId={albumId} onPlayAt={onPlayAt} />
            : <T size={11} dim>{tx('common.loading2')}</T>}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  btn: { padding: 10, borderRadius: 10, alignItems: 'center' },
  section: { marginTop: 4, paddingTop: 10, borderTopWidth: 1 },
});
