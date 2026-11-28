import {
  addonSearchInfo, pendingFromEvent, previewFromAddon, previewFromEvent, previewMark, previewReserve, previewSearchParams, previewTimeLabel,
  searchGenreLabel, searchTimes, type AutoAddForm, type PreviewItem, type Reserve,
} from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ProgramSheet } from '../../epg/ProgramSheet';
import { searchGenreStyle } from '../../search/colors';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { openNewAutoAdd } from '../pending';
import { shadow } from '../../../ui/theme/edge';
import { useT, localizeFmt } from '../../../ui/i18n/I18n';

/** 試しの検索（予約はしない）。EDCB の局は番組検索で、配信の局は録画アドオンに同じ照合で探してもらう */
export function AutoAddPreview({ form, node, addonMode, addonName, addonChs, reserves, onReserved }: {
  form: AutoAddForm; node: string | null; addonMode: boolean; addonName: string | undefined; addonChs: string[];
  reserves: Reserve[]; onReserved: () => void;
}) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [days, setDays] = useState(14);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PreviewItem[] | null>(null);
  const [sheet, setSheet] = useState<PreviewItem | null>(null);

  const run = async () => {
    setSearching(true);
    setResults(null);
    try {
      if (addonMode) {
        const r = await api.autoAdd.addonPreview(addonName!, { channels: addonChs, days, search_info: addonSearchInfo(form, form.contentList) }, node);
        setResults((r.result?.programs ?? []).map(previewFromAddon));
      } else {
        setResults((await api.epg.search(previewSearchParams(form, days), node)).map(previewFromEvent));
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };
  const now = Date.now();
  const future = results?.filter((r) => r.end > now) ?? [];

  // 押した番組のシート（予約は題名と開始の分で見る）
  const e = sheet?.event ?? null;
  const res = sheet ? previewReserve(reserves, sheet) : undefined;
  const mark = previewMark(res);
  const close = () => setSheet(null);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); onReserved(); close(); } catch { /* 元と同じく黙って閉じない */ } };
  const gs = e ? searchGenreStyle(e.content_nibble) : null;

  return (
    <>
      <View style={styles.row}>
        <Pressable onPress={() => void run()} disabled={searching}
          style={[styles.btn, { backgroundColor: searching ? theme.surface2 : accent.primary, borderColor: theme.frame, boxShadow: searching ? 'none' : shadow(theme, 2) }]}>
          <T mono size={12} w={800} color={searching ? theme.mute : '#fff'}>{searching ? tx('common.searching') : tx('autoReserve.autoAddPreview.previewSearch')}</T>
        </Pressable>
        <TextInput value={String(days)} keyboardType="number-pad" onChangeText={(v) => setDays(Math.min(30, parseInt(v, 10) || 7))}
          style={[styles.days, { borderColor: theme.line, backgroundColor: theme.surface2, color: theme.ink }]} />
        <T size={10} dim>{tx('autoReserve.autoAddPreview.days')}</T>
      </View>

      {results && (
        <View>
          {/* 配信の番組表は8日分しか無い（録画アドオンの _AUTO_DAYS） */}
          <T mono size={10} dim style={styles.mb6}>{tx('autoReserve.autoAddPreview.resultsNextDaysNow', { v0: future.length, v1: addonMode ? Math.min(days, 8) : days })}</T>
          {future.length === 0 && results.length === 0 && <T size={12} dim style={styles.none}>{tx('common.noMatches')}</T>}
          <View style={styles.list}>
            {future.slice(0, 30).map((r, i) => {
              const m = previewMark(previewReserve(reserves, r));
              return (
                // 配信の番組は EDCB で予約できないので、押してもシートは開かない
                <Pressable key={i} disabled={r.addon} onPress={() => setSheet(r)}
                  style={[styles.item, { backgroundColor: theme.surface, borderColor: theme.line, opacity: r.dup ? 0.55 : 1 }]}>
                  <View style={styles.meta}>
                    <View style={[styles.station, { backgroundColor: theme.surface2 }]}><T mono size={9} dim numberOfLines={1}>{r.station}</T></View>
                    <T mono size={9} dim>{localizeFmt(previewTimeLabel(r))}</T>
                    {r.dup && <View style={[styles.tag, { backgroundColor: theme.surface2 }]}><T mono size={9} w={700} dim>{tx('autoReserve.autoAddPreview.dup')}</T></View>}
                    {m && (
                      <View style={[styles.tag, { backgroundColor: m === 'SKIP' ? theme.surface2 : accent.primary }]}>
                        <T mono size={9} w={700} color={m === 'SKIP' ? theme.mute : '#fff'}>{m}</T>
                      </View>
                    )}
                  </View>
                  <T size={12} w={700}>{r.title}</T>
                </Pressable>
              );
            })}
            {future.length > 30 && <T size={10} dim style={styles.more}>{tx('autoReserve.autoAddPreview.more', { v0: future.length - 30 })}</T>}
          </View>
        </View>
      )}

      <ProgramSheet e={e} node={node} station={e?.station_name} force={undefined}
        status={mark === 'SKIP' ? 'skip' : mark === 'REC' ? 'rec' : undefined}
        timeLabel={e ? localizeFmt(searchTimes(e).sheet) : undefined}
        genre={e && gs ? { ...gs, label: searchGenreLabel(e.content_nibble) } : undefined}
        flags={false} fetchDetail={false}
        onClose={close}
        onReserve={res ? undefined : () => void act(() => api.epg.reserve(e!, 1, node))}
        onSkip={mark !== 'SKIP' ? () => void act(() => (res ? api.reserves.skip(res.reserve_id, node) : api.epg.reserve(e!, 0, node))) : undefined}
        onUnskip={mark === 'SKIP' ? () => void act(() => api.reserves.unskip(res!.reserve_id, node)) : undefined}
        onAutoAdd={e ? () => { close(); openNewAutoAdd(pendingFromEvent(e), node); } : undefined} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: { flex: 1, padding: 11, borderRadius: 11, borderWidth: 1.5, alignItems: 'center' },
  days: { width: 44, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1.5, fontSize: 12, textAlign: 'center' },
  mb6: { marginBottom: 6 },
  none: { textAlign: 'center', paddingVertical: 20 },
  list: { gap: 5 },
  item: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' },
  station: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3, maxWidth: 100 },
  tag: { paddingVertical: 1, paddingHorizontal: 5, borderRadius: 3 },
  more: { textAlign: 'center', paddingVertical: 4 },
});
