import { AUDIO_ONLY, STREAM_QUALITIES, qualityLabel, type Quality } from '@tstag/core';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chip } from '../../ui/inputs/Chip';
import { Sheet, SheetItem } from '../../ui/sheets/Sheet';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/** 再生速度の段階（元の Web 版と同じ） */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** 再生画面の「…」（元の PlayerMoreMenu）: 再生速度・画質・続けて流す・プレイヤーの再起動・キー操作 */
export function WatchMenuSheet(p: {
  open: boolean;
  onClose: () => void;
  rate: number;
  setRate: (v: number) => void;
  /** 元のファイルのまま流している（画質は選べない） */
  direct: boolean;
  /** 端末の保存から再生している */
  local: boolean;
  isMusic: boolean;
  videoCodec?: string;
  quality: Quality;
  setQuality: (q: Quality) => void;
  autoNext: boolean;
  onToggleAutoNext: () => void;
  onRestart: () => void;
  /** キー操作の一覧を開く（使えない端末では出さない） */
  onKeyHelp?: () => void;
}) {
  const { t: tx } = useT();
  const { accent } = useTheme();
  return (
    <Sheet open={p.open} onClose={p.onClose} title={tx('common.other')}>
      <MenuRow label={tx('player.watchMenuSheet.playbackSpeed')}>
        {SPEEDS.map((v) => <Chip key={v} size="sm" color={accent.primary} active={v === p.rate} onPress={() => p.setRate(v)}>{`${v}×`}</Chip>)}
      </MenuRow>
      {/* サーバーで変換できない形式（動画サイトの AV1・Opus 音声など）は元のファイルのまま流すので画質は選べない。
          理由と直し方を出す（何も出さないと項目が消えたように見えた） */}
      {p.direct && !p.local && !p.isMusic && (
        <MenuRow label={tx('common.quality')}>
          <T size={11} dim>{tx('player.watchMenuSheet.playingOriginalFileFormat', { v0: p.videoCodec || tx('player.watchMenuSheet.unknown') })}</T>
        </MenuRow>
      )}
      {!p.direct && (
        <MenuRow label={tx('common.quality')}>
          {[...STREAM_QUALITIES, AUDIO_ONLY].map((q) => (
            <Chip key={q} size="sm" color={accent.primary} active={q === p.quality}
              onPress={() => { p.setQuality(q as Quality); p.onClose(); }}>{qualityLabel(q as Quality)}</Chip>
          ))}
        </MenuRow>
      )}
      <SheetItem label={tx('player.watchMenuSheet.autoplayGoNextEpisode', { v0: p.autoNext ? '✓' : '　' })} onPress={p.onToggleAutoNext} />
      <SheetItem label={tx('common.restartPlayer')} onPress={() => { p.onClose(); p.onRestart(); }} />
      {p.onKeyHelp && <SheetItem label={tx('common.keyboardRemoteControls')} onPress={() => { p.onClose(); p.onKeyHelp?.(); }} />}
    </Sheet>
  );
}

function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.menuRow}>
      <T mono size={10} dim>{label}</T>
      <View style={styles.menuChips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  menuRow: { gap: 6, paddingVertical: 8 },
  menuChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
