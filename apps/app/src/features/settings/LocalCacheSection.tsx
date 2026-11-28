import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { clearShareCache, shareCacheUsage } from '../../lib/device/downloadShare';
import { cellularDownload, useCellularDownload } from '../../lib/localSave/cellular';
import { localSave } from '../../lib/localSave/store';
import { Trash } from '../../ui/parts/Icons';
import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { Sheet } from '../../ui/sheets/Sheet';
import { Switch } from '../../ui/inputs/Switch';
import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { Card } from './parts';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;

/** 設定の「ローカルキャッシュ」（元の SettingsApp）: 端末に保存した動画と、端末へ保存する時の一時ファイルの使用量と、全部消す */
export function LocalCacheSection() {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [bytes, setBytes] = useState<number | null>(null);
  const [shareBytes, setShareBytes] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const cellular = useCellularDownload();
  useEffect(() => {
    if (!localSave.available()) return;
    void localSave.usage().then(setBytes).catch(() => {});
    setShareBytes(shareCacheUsage());
  }, []);
  if (!localSave.available()) return null;
  const clear = async () => {
    setConfirm(false);
    setClearing(true);
    try { await localSave.clear(); clearShareCache(); } finally { setClearing(false); }
    setBytes(await localSave.usage().catch(() => 0));
    setShareBytes(shareCacheUsage());
  };
  return (
    <>
      <SectionTitle>{tx('settings.localCacheSection.localCache')}</SectionTitle>
      <Card pad>
        <T mono size={10} dim style={styles.note}>
          {tx('settings.localCacheSection.videosDownloadedLibraryTheir', { v0: tx(Platform.OS === 'web' ? 'settings.general.inBrowser' : 'settings.general.inApp') })}
          {bytes != null && <>{tx('settings.localCacheSection.usedSavedVideos')}<T mono size={10} w={700}>{mb(bytes)}</T></>}
          {shareBytes > 0 && <>{tx('settings.localCacheSection.tempFilesSavingDevice')}<T mono size={10} w={700}>{mb(shareBytes)}</T></>}
        </T>
        {cellularDownload.available() && (
          <View style={[styles.opt, { borderColor: theme.line }]}>
            <View style={styles.grow}>
              <T size={12} w={500}>{tx('settings.localCacheSection.downloadMobileDataToo')}</T>
              <T mono size={9} dim>{cellular ? tx('settings.localCacheSection.downloadsWiFiMobile') : tx('settings.localCacheSection.waitsMobileDataDownloads')}</T>
            </View>
            <Switch on={cellular} onChange={() => cellularDownload.set(!cellular)} label={tx('settings.localCacheSection.downloadMobileDataToo')} />
          </View>
        )}
        <Pressable onPress={() => setConfirm(true)} disabled={clearing}
          style={[styles.btn, { borderColor: theme.frame, boxShadow: shadow(theme, 3), opacity: clearing ? 0.6 : 1 }]}>
          <Trash s={14} c="#fff" /><T mono size={12} w={800} color="#fff">{clearing ? tx('common.deleting') : tx('settings.localCacheSection.clearAllCache')}</T>
        </Pressable>
      </Card>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={tx('settings.localCacheSection.clearEntireCache')}>
        <View style={[styles.box, { backgroundColor: theme.surface2 }]}>
          <T mono size={10} dim>{tx('settings.localCacheSection.deletesVideosPlaybackData')}</T>
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => setConfirm(false)} style={[styles.sheetBtn, { borderColor: theme.frame }]}><T size={13} w={700}>{tx('common.cancel')}</T></Pressable>
          <Pressable onPress={() => void clear()} style={[styles.sheetBtn, { borderColor: theme.frame, backgroundColor: RED }]}><T size={13} w={800} color="#fff">{tx('common.delete2')}</T></Pressable>
        </View>
      </Sheet>
    </>
  );
}

const RED = oklch(0.6, 0.22, 25);
const styles = StyleSheet.create({
  note: { lineHeight: 16, marginBottom: 10 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, marginBottom: 10, borderTopWidth: 1, borderBottomWidth: 1 },
  grow: { flex: 1, gap: 2 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 12, borderWidth: 1.5, backgroundColor: oklch(0.55, 0.22, 25) },
  box: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 8 },
  sheetBtn: { flex: 1, padding: 13, borderRadius: 13, borderWidth: 1.5, alignItems: 'center' },
});
