import { amzEncoderOption, amzFilterSummary, type AmzProfile } from '@tstag/core';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { amzStyles } from './amzStyles';
import { AmzProfileForm } from './form/AmzProfileForm';
import { confirmAsync } from '../../../lib/device/confirm';
import { Trash } from '../../../ui/parts/Icons';
import { oklch } from '../../../ui/theme/oklch';
import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** プロファイルの1行（元の AmzProfileRow）: 開くとオプションとまとめ、編集・名前を変える・削除 */
export function AmzProfileRow({ profile, last, onSave, onSaveAs, onRename, onDelete }: {
  profile: AmzProfile; last: boolean;
  onSave: (name: string, p: AmzProfile) => Promise<unknown>;
  onSaveAs: (name: string, p: AmzProfile) => Promise<unknown>;
  onRename: (oldName: string, newName: string, p: AmzProfile) => Promise<unknown>;
  onDelete: (name: string) => Promise<unknown>;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [busy, setBusy] = useState(false);
  const opt = amzEncoderOption(profile);
  const remove = async () => {
    if (!(await confirmAsync(tx('settings.amzProfileRow.deleteProfile', { v0: profile.name }), tx('reservations.list.sheet.delete')))) return;
    setBusy(true);
    onDelete(profile.name).catch(() => setBusy(false));
  };
  const rename = () => {
    const n = renameVal.trim();
    if (!n || n === profile.name) { setRenaming(false); return; }
    setBusy(true);
    onRename(profile.name, n, profile).then(() => setRenaming(false)).catch(() => setBusy(false));
  };
  const facts = [
    profile.outputFormat && ['format', profile.outputFormat],
    profile.bitrate && ['bitrate', `a=${profile.bitrate.a} b=${profile.bitrate.b} h264=${profile.bitrate.h264}`],
    (profile.filterOption || profile.filterSetting) && ['filter', amzFilterSummary(profile)],
    profile.numEncodeBufferFrames != null && ['buf', String(profile.numEncodeBufferFrames)],
    profile.encoderParallel != null && ['parallel', String(profile.encoderParallel)],
  ].filter(Boolean) as [string, string][];
  const dim = { opacity: busy ? 0.5 : 1 };

  return (
    <View style={!last && { borderBottomWidth: 1, borderBottomColor: theme.line }}>
      <View style={styles.head}>
        <View style={amzStyles.grow}>
          <T mono size={12} w={700}>{profile.name}</T>
          {!!profile.lastUpdate && <T mono size={9} dim>{new Date(profile.lastUpdate).toLocaleString('ja-JP')}</T>}
        </View>
        {!!profile.encoderType && (
          <View style={[styles.enc, { backgroundColor: `${accent.tertiary}22`, borderColor: accent.tertiary }]}><T mono size={9} color={accent.tertiary}>{profile.encoderType}</T></View>
        )}
        <Pressable onPress={() => { setExpanded(!expanded); setEditing(false); }} style={[amzStyles.small, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          <T size={9} dim>{expanded ? '▲' : '▼'}</T>
        </Pressable>
      </View>
      {expanded && !editing && (
        <View style={[styles.detail, { borderTopColor: theme.line, backgroundColor: theme.surface2 }]}>
          {opt && (
            <>
              <T mono size={9} dim style={styles.mb3}>{opt.key}</T>
              <View style={[styles.opt, { backgroundColor: theme.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)' }]}><T mono size={9} color={accent.primary}>{opt.value}</T></View>
            </>
          )}
          <View style={styles.facts}>
            {facts.map(([k, v]) => <T key={k} mono size={9} dim>{`${k}: `}<T mono size={9}>{v}</T></T>)}
          </View>
          {renaming ? (
            <View style={styles.btnRow}>
              <TextInput value={renameVal} onChangeText={setRenameVal} autoFocus autoCapitalize="none" onSubmitEditing={rename}
                style={[styles.renameInput, { borderColor: theme.frame, backgroundColor: theme.surface, color: theme.ink }]} />
              <Pressable onPress={rename} disabled={busy || !renameVal.trim()} style={[styles.btn, dim, { backgroundColor: busy || !renameVal.trim() ? theme.surface2 : accent.primary, borderColor: theme.frame }]}>
                <T size={10} w={700} color="#fff">{tx('settings.amzProfileRow.ok')}</T>
              </Pressable>
              <Pressable onPress={() => setRenaming(false)} style={[styles.btn, { borderColor: theme.line }]}><T size={10} dim>✕</T></Pressable>
            </View>
          ) : (
            <View style={styles.btnRow}>
              <Pressable onPress={() => setEditing(true)} style={[styles.btn, { backgroundColor: accent.secondary, borderColor: theme.frame }]}><T size={10} w={700} color="#fff">{tx('common.edit')}</T></Pressable>
              <Pressable onPress={() => { setRenameVal(profile.name); setRenaming(true); }} disabled={busy} style={[styles.btn, dim, { backgroundColor: theme.surface, borderColor: theme.frame }]}>
                <T size={10} w={700}>{tx('settings.amzProfileRow.rename')}</T>
              </Pressable>
              <Pressable onPress={() => void remove()} disabled={busy} style={[styles.btn, styles.del, dim]}>
                <Trash s={10} c={oklch(0.45, 0.22, 25)} />
                <T size={10} w={700} color={oklch(0.45, 0.22, 25)}>{tx('reservations.list.sheet.delete')}</T>
              </Pressable>
            </View>
          )}
        </View>
      )}
      {expanded && editing && (
        <AmzProfileForm initial={profile} onCancel={() => setEditing(false)}
          onSave={(upd) => onSave(profile.name, upd).then(() => setEditing(false))}
          onSaveAs={(n, upd) => onSaveAs(n, upd).then(() => setEditing(false))} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 13, gap: 8 },
  enc: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, borderWidth: 1 },
  detail: { paddingTop: 8, paddingBottom: 12, paddingHorizontal: 13, borderTopWidth: 1, borderStyle: 'dashed' },
  mb3: { marginBottom: 3 },
  opt: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 7, marginBottom: 8 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginBottom: 10 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  renameInput: { flex: 1, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  btn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  del: { backgroundColor: oklch(0.92, 0.06, 25), borderColor: oklch(0.6, 0.22, 25) },
});
