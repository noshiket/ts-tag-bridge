import { useApi } from '@tstag/core/react';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ResultMessage } from '../../ui/parts/ResultMessage';
import { ScrollSheet } from '../../ui/sheets/ScrollSheet';
import { SheetButtons } from '../../ui/sheets/SheetButtons';
import { Switch } from '../../ui/inputs/Switch';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { useT } from '../../ui/i18n/I18n';

/**
 * 動画の tag.json を見る・直す（元の TagJsonSheet）。確定値の編集に出ない項目（eit_start_time など）を直すため。
 * 「ライブラリへも反映」で videos の列にある項目とカテゴリも直す
 */
export function TagJsonSheet({ videoId, node, open, onClose, onApplied }: {
  videoId: number; node: string | null; open: boolean; onClose: () => void; onApplied: () => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme } = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [exists, setExists] = useState(true);
  const [apply, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    setText(null);
    setMsg(null);
    api.videoActions.tag(videoId, node)
      .then((d) => { if (!dead) { setPath(d.tag_path || ''); setExists(!!d.exists); setText(JSON.stringify(d.tag || {}, null, 2)); } })
      .catch((e: Error) => { if (!dead) { setText(''); setMsg({ ok: false, text: e.message || tx('library.tagJsonSheet.failedLoad') }); } });
    return () => { dead = true; };
  }, [api, videoId, node, open]);

  const save = async () => {
    if (busy || text == null) return;
    let tag: unknown;
    try { tag = JSON.parse(text); } catch (e) { setMsg({ ok: false, text: tx('library.tagJsonSheet.notValid', { v0: e instanceof Error ? e.message : e }) }); return; }
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) { setMsg({ ok: false, text: tx('library.tagJsonSheet.topLevelMustObject') }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.videoActions.saveTag(videoId, tag as Record<string, unknown>, apply, node);
      const cols = (r.updated || []).join(', ');
      setMsg({ ok: true, text: r.applied ? `保存しました${cols ? ` — DBへ反映: ${cols}` : '（DBへ反映する項目はありませんでした）'}` : '保存しました（tag.json のみ）' });
      setText(JSON.stringify(tag, null, 2));
      if (r.applied) onApplied();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : tx('common.couldntSave') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollSheet open={open} onClose={onClose} busy={busy} tall>
      <T size={13} w={800}>tag.json</T>
      <T mono size={9} dim style={styles.path}>{`${path}${exists ? '' : tx('library.tagJson.notYet')}`}</T>
      {text == null ? <T size={12} dim style={styles.loading}>{tx('common.loading2')}</T> : (
        <TextInput value={text} onChangeText={(v) => { setText(v); setMsg(null); }} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false}
          style={[styles.area, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
      )}
      <View style={styles.applyRow}>
        <Switch on={apply} onChange={() => setApply(!apply)} label={tx('library.tagJsonSheet.alsoApplyLibraryVideo')} />
        <T size={11}>{tx('library.tagJsonSheet.alsoApplyLibraryVideo')}</T>
      </View>
      <T mono size={9} dim style={styles.note}>
        {tx('library.tagJsonSheet.updatesVideosColumnsEit')}
      </T>
      <ResultMessage msg={msg} style={styles.msg} />
      <SheetButtons wide onClose={onClose} onSubmit={() => void save()} busy={busy} canSubmit={!busy && text != null} label={busy ? tx('common.saving2') : tx('common.save')} />
    </ScrollSheet>
  );
}

const styles = StyleSheet.create({
  path: { marginTop: 2, marginBottom: 10, lineHeight: 15 },
  loading: { textAlign: 'center', padding: 30 },
  area: { minHeight: 320, padding: 10, borderRadius: 9, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400], lineHeight: 17, textAlignVertical: 'top' },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  note: { marginTop: 4, lineHeight: 15 },
  msg: { marginTop: 10 } });
