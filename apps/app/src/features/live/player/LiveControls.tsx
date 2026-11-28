import { LIVE_QUALITIES, STATUS_COLORS, type LiveStatus } from '@tstag/core';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import type { LiveToggles } from './useLiveToggles';
import { FullscreenIcon, PipIcon, RotateIcon } from '../../player/PlayerControls';
import { Chip } from '../../../ui/inputs/Chip';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { Slider } from '../../../ui/inputs/Slider';
import { canControlVolume } from '../../../ui/inputs/volumeSupport';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 映像の上: エラー、つながるまで・バッファ中の表示 */
export function LiveStageStatus({ error, loading, status }: { error: string | null; loading: boolean; status: LiveStatus }) {
  const { t: tx } = useT();
  return (
    <>
      {!!error && <View pointerEvents="none" style={styles.center}><T size={14} color="#ef4444">{error}</T></View>}
      {loading && (
        <View pointerEvents="none" style={[styles.center, styles.loading]}>
          <ActivityIndicator size="large" color="#10b981" />
          {status.status !== 'ONAir' ? (
            <>
              <T mono size={13} w={700} color={STATUS_COLORS[status.status] ?? '#fff'}>{status.status}</T>
              {!!status.detail && <T size={12} color="#fff" style={styles.faint}>{status.detail}</T>}
            </>
          ) : <T size={12} color="#fff" style={styles.faint}>{tx('live.liveControls.buffering')}</T>}
        </View>
      )}
    </>
  );
}

/**
 * 操作の表示。上: 戻る / 局名 / 番組名と残り、真ん中: 再生 / 停止、
 * 下: 番組の進み / バッファ / 人数 / 字幕・弾幕・小窓・全画面・回転・パネル・音声・その他・音量
 */
export function LiveControls({ c }: { c: {
  title: string; sub: string; program: string | null; progPct: number | null; paused: boolean; bufferSec: number; clients: number;
  t: LiveToggles; hasSecondary: boolean; canPip: boolean; pipActive: boolean; fullscreen: boolean;
  rot: { show: boolean; on: boolean; toggle: () => void }; panel: { show: boolean; open: boolean; toggle: () => void };
  onBack: () => void; togglePlay: () => void; startPip: () => void; toggleFullscreen: () => void; openMenu: () => void; bump: () => void;
} }) {
  const { t: tx } = useT();
  const { t, bump } = c;
  const tap = (f: () => void) => () => { f(); bump(); };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.top}>
        <Pressable onPress={c.onBack} style={styles.backBtn}><T mono size={12} color="#fff">{tx('live.liveControls.guide')}</T></Pressable>
        <T size={14} w={700} color="#fff" numberOfLines={1}>{c.title}</T>
        <T mono size={11} color="rgba(255,255,255,0.7)">{c.sub}</T>
        {c.program && <T size={12} color="rgba(255,255,255,0.85)" numberOfLines={1} style={styles.flexRight}>{c.program}</T>}
      </View>
      <View style={styles.center} pointerEvents="box-none">
        <Pressable onPress={c.togglePlay} style={styles.bigPlay}><T size={30} color="#fff">{c.paused ? '▶' : '❚❚'}</T></Pressable>
      </View>
      <View style={styles.bottom}>
        {c.progPct != null && <View style={styles.progBar}><View style={[styles.progFill, { width: `${c.progPct}%` }]} /></View>}
        <View style={styles.ctrlRow}>
          <T mono size={10} color="rgba(255,255,255,0.5)">{`⎈ ${c.bufferSec.toFixed(1)}s`}</T>
          {c.clients > 0 && <T size={10} color="rgba(255,255,255,0.5)">{`👤 ${c.clients}`}</T>}
          <View style={styles.flex} />
          <Icon on={t.captionOn} onPress={tap(t.toggleCaption)}>{tx('library.video.cc')}</Icon>
          <Icon on={t.commentsOn} onPress={tap(t.toggleComments)}>{tx('common.c')}</Icon>
          {c.canPip && <Icon label={tx('common.miniPlayer')} on={c.pipActive} onPress={tap(c.startPip)}><PipIcon color={c.pipActive ? '#000' : '#fff'} /></Icon>}
          <Icon label={tx('common.fullscreen')} on={c.fullscreen} onPress={tap(c.toggleFullscreen)}><FullscreenIcon color={c.fullscreen ? '#000' : '#fff'} /></Icon>
          {c.rot.show && <Icon label={tx('common.landscape')} on={c.rot.on} onPress={tap(c.rot.toggle)}><RotateIcon color={c.rot.on ? '#000' : '#fff'} /></Icon>}
          {c.panel.show && <Icon on={c.panel.open} onPress={c.panel.toggle}>▤</Icon>}
          <Icon on={t.audioTrack === 'sub'} disabled={!c.hasSecondary} onPress={tap(t.toggleAudio)}>{t.audioTrack === 'sub' ? tx('library.video.sap') : tx('common.main')}</Icon>
          <Icon on={false} onPress={c.openMenu}>⋯</Icon>
          <Pressable onPress={tap(t.toggleMute)}><T size={16} color="#fff">{t.muted ? '🔇' : '🔊'}</T></Pressable>
          {canControlVolume() && (<Slider label={tx('common.volume')} value={t.muted ? 0 : t.volume} width={80} onChange={(v) => { t.setVol(v, false); bump(); }} onDone={t.saveVol} />)}
        </View>
      </View>
    </View>
  );
}

/** 「⋯」: 画質・プレイヤーの再起動・キー操作の一覧 */
export function LiveMenuSheet({ open, onClose, quality, setQuality, restart, showKeys }: {
  open: boolean; onClose: () => void; quality: string; setQuality: (q: string) => void; restart: () => void; showKeys?: () => void;
}) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  return (
    <Sheet open={open} onClose={onClose} title={tx('common.other')}>
      <T mono size={11} dim style={styles.menuLabel}>{tx('common.quality')}</T>
      <View style={styles.chips}>
        {LIVE_QUALITIES.map((q) => <Chip key={q} size="sm" color={accent.primary} active={q === quality} onPress={() => { setQuality(q); onClose(); }}>{q}</Chip>)}
      </View>
      <SheetItem label={tx('common.restartPlayer')} onPress={() => { restart(); onClose(); }} />
      {showKeys && <SheetItem label={tx('common.keyboardRemoteControls')} onPress={() => { onClose(); showKeys(); }} />}
    </Sheet>
  );
}

function Icon({ label, on, disabled, onPress, children }: { label?: string; on: boolean; disabled?: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} style={[styles.icon, { backgroundColor: on ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.12)', opacity: disabled ? 0.4 : 1 }]}>
      {typeof children === 'string' ? <T mono size={13} color={on ? '#000' : '#fff'}>{children}</T> : children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  faint: { opacity: 0.85 },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loading: { backgroundColor: 'rgba(0,0,0,0.55)' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(0,0,0,0.45)' },
  backBtn: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(0,0,0,0.3)' },
  flexRight: { flex: 1, textAlign: 'right' },
  bigPlay: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: 6, paddingTop: 18, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.5)' },
  progBar: { height: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: '#10b981', borderRadius: 999 },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 6 },
  icon: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, minHeight: 25, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { paddingHorizontal: 16, paddingTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
});
