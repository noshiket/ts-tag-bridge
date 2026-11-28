import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { BasicSections } from './BasicSections';
import { DetailSections } from './DetailSections';
import { FederationSection } from './FederationSection';
import { useConfigEditor } from './useConfigEditor';
import { oklch } from '../../../ui/theme/oklch';
import { SectionTitle } from '../../../ui/parts/SectionTitle';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { shadow } from '../../../ui/theme/edge';
import { useT } from '../../../ui/i18n/I18n';

/**
 * サーバーの設定（config.yml）の編集（元の SettingsApp の CONFIG）。変えた項目だけ保存し、
 * 再起動が要る変更なら「再起動して反映」を出す。見ているサーバーのもの。
 * 最初は基本の設定（BasicSections）だけ出し、「詳細設定を表示」で残り（DetailSections・FederationSection）と設定の名前を出す。
 * 状態と操作は useConfigEditor、入力の部品は configFields と choiceFields
 */
export function ConfigEditor() {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const c = useConfigEditor();
  const { hasDirty, saved, saving } = c;
  return (
    <>
      <Modal visible={c.restarting !== 'no'} transparent animationType="fade">
        <View style={styles.overlay}>
          <T mono size={14} w={800} color="#fff">{c.restarting === 'failed' ? tx('settings.configEditor.restartMayHaveFailed') : tx('settings.configEditor.restartingServer')}</T>
          <T mono size={10} color="#ccc" style={styles.center}>{c.restarting === 'failed' ? tx('settings.configEditor.checkTagBridgeLog') : tx('settings.configEditor.waitingComeBackReconnects')}</T>
          {c.restarting === 'failed' && <Pressable onPress={() => c.setRestarting('no')}><T mono size={11} color="#fff">{tx('common.close')}</T></Pressable>}
        </View>
      </Modal>

      <SectionTitle>{tx('settings.configEditor.serverSettings')}</SectionTitle>
      {c.cfg === null ? <T mono size={10} dim style={styles.pad12}>{tx('common.loading')}</T> : (
        <>
          {c.needsRestart && (
            <View style={styles.restart}>
              <T mono size={10} w={700} style={styles.shrink}>{tx('settings.configEditor.restartNeededApplyChanges')}</T>
              <Pressable onPress={() => void c.restart()} style={styles.restartBtn}><T mono size={10} w={800} color="#fff">{tx('settings.configEditor.restartApply')}</T></Pressable>
            </View>
          )}
          <BasicSections c={c} />
          <Pressable onPress={() => c.setDetail(!c.detail)} style={[styles.detail, { borderColor: theme.line }]}>
            <T size={11} w={700}>{c.detail ? tx('settings.configEditor.hideAdvanced') : tx('settings.configEditor.showAdvanced')}</T>
            {!c.detail && <T size={9} dim>{tx('settings.configEditor.connectionsToolsWorkerIntervals')}</T>}
          </Pressable>
          {c.detail && (
            <>
              <DetailSections c={c} />
              <FederationSection c={c} />
            </>
          )}
          <Pressable onPress={() => void c.save()} disabled={!hasDirty || saving} style={[styles.save, {
            backgroundColor: saved ? oklch(0.72, 0.2, 135) : hasDirty ? accent.primary : theme.surface2,
            borderColor: theme.frame, boxShadow: hasDirty ? shadow(theme, 3) : 'none', opacity: saving ? 0.6 : 1,
          }]}>
            <T mono size={12} w={800} color={hasDirty || saved ? '#fff' : theme.mute}>
              {tx(saved ? 'common.saved2' : saving ? 'common.saving' : 'settings.general.saveSettings')}
            </T>
          </Pressable>
          {/* 設定を変えていない時でも、手でサーバーを再起動できる（確かめてから） */}
          <Pressable onPress={() => void c.restart()} style={[styles.restartRow, { borderColor: theme.line }]}>
            <T size={11} w={700}>{tx('settings.configEditor.restartServerNow')}</T>
            <T size={9} dim>{tx('settings.configEditor.restartServerNowSub')}</T>
          </Pressable>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  center: { textAlign: 'center' },
  restartRow: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', gap: 2 },
  pad12: { padding: 12 },
  shrink: { flexShrink: 1 },
  restart: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10, paddingHorizontal: 13, marginBottom: 12,
    borderRadius: 12, borderWidth: 1.5, backgroundColor: 'rgba(240,190,90,0.25)', borderColor: oklch(0.6, 0.18, 70),
  },
  restartBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: oklch(0.6, 0.18, 70) },
  detail: { paddingVertical: 10, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', gap: 3, marginBottom: 12 },
  save: { padding: 10, borderRadius: 12, borderWidth: 1.5, marginBottom: 16, alignItems: 'center' },
});
