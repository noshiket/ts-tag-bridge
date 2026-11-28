import { stripTitleType, type PatternCtx, type ShoboiProgram, type ShoboiTitleHit } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { danger, monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** しょぼいカレンダーの値をアクションへ入れる指示（元の ShoboiPanel の onApply） */
export type ShoboiApply =
  | { type: 'tid'; value: string }
  | { type: 'setStr'; field: string; str: string }
  | { type: 'getShoboiSubtitle'; field: string; tid: string; episodeField: string };

type Row = { label: string; value: string; btns?: [string, ShoboiApply][]; links?: [string, string][] } | null | false | '' | undefined;

/** しょぼいカレンダーを引いて、題名・TID などをアクションへ入れる（元の pattern.jsx の ShoboiPanel） */
export function ShoboiPanel({ ctx, onClose, g1Text, onApply }: { ctx: PatternCtx | null; onClose: () => void; g1Text: string; onApply: (a: ShoboiApply) => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [tab, setTab] = useState<'title' | 'sid'>('title');
  const [query, setQuery] = useState(g1Text || '');
  const [sid, setSid] = useState(String(ctx?.sid || ''));
  const [startTime, setStartTime] = useState(ctx?.start || '');
  const [results, setResults] = useState<{ type: 'title'; data: ShoboiTitleHit[] } | { type: 'sid'; data: ShoboiProgram[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | number | null>(null);
  const [info, setInfo] = useState<Record<string, { wiki_title?: string; wiki_url?: string } | null>>({});

  useEffect(() => { setSid(String(ctx?.sid || '')); setStartTime(ctx?.start || ''); }, [ctx?.sid, ctx?.start]);
  useEffect(() => { if (g1Text) { setQuery(g1Text); setTab('title'); } }, [g1Text]);

  const run = async (fn: () => Promise<NonNullable<typeof results>>) => {
    setLoading(true); setError(''); setResults(null);
    try { setResults(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  const searchTitle = () => { if (query.trim()) void run(async () => ({ type: 'title', data: await api.patterns.shoboiSearch(query.trim()) })); };
  const searchSid = () => { if (sid && startTime) void run(async () => ({ type: 'sid', data: (await api.patterns.shoboiPrograms(Number(sid), startTime)).programs ?? [] })); };
  // 作品を開いた時に Wiki の題名を取る
  const openTitle = (tid: number) => {
    setSel((s) => (s === tid ? null : tid));
    if (String(tid) in info) return;
    setInfo((p) => ({ ...p, [tid]: null }));
    api.patterns.shoboiTitle(tid).then((d) => setInfo((p) => ({ ...p, [tid]: d }))).catch(() => setInfo((p) => ({ ...p, [tid]: {} })));
  };

  const set2 = (v: string): [string, ShoboiApply][] => [['→title', { type: 'setStr', field: 'title', str: v }], ['→folder', { type: 'setStr', field: 'folder', str: v }]];
  const linkRow = (tid: number, wikiUrl?: string, wikiTitle?: string): Row => {
    const links: [string, string][] = [['しょぼい', `https://cal.syoboi.jp/tid/${tid}`]];
    const wu = wikiUrl || (wikiTitle ? `https://ja.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}` : '');
    if (wu) links.push(['Wiki', wu]);
    return { label: tx('patterns.shoboiPanel.link'), value: '', links };
  };
  const detail = (rows: Row[]) => (
    <View style={styles.detail}>
      {rows.filter((r): r is Exclude<Row, null | false | '' | undefined> => !!r).map((r) => (
        <View key={r.label} style={styles.dRow}>
          <T mono size={9} color={accent.primary} style={styles.dLabel}>{r.label}</T>
          <T mono size={10} numberOfLines={1} style={styles.grow}>{r.value}</T>
          {(r.links ?? []).map(([l, u]) => (
            <Pressable key={l} onPress={() => void Linking.openURL(u)} style={[styles.link, { borderColor: accent.primary }]}>
              <T mono size={9} w={700} color={accent.primary}>{`${l}↗`}</T>
            </Pressable>
          ))}
          {(r.btns ?? []).map(([l, a]) => (
            <Pressable key={l} onPress={() => onApply(a)} style={[styles.link, { backgroundColor: accent.primary, borderColor: accent.primary }]}>
              <T mono size={9} w={700} color="#fff">{l}</T>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
  const input = [styles.input, { borderColor: theme.line, backgroundColor: theme.surface, color: theme.ink }];
  const empty = (s: string) => <T size={11} dim style={styles.empty}>{s}</T>;

  return (
    <View style={[styles.panel, { backgroundColor: theme.bg, borderBottomColor: accent.primary }]}>
      <View style={[styles.head, { borderBottomColor: theme.line }]}>
        <T mono size={9} w={800} color={accent.primary}>SHOBOI CALENDAR</T>
        <View style={[styles.tabs, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
          {([['title', tx('patterns.shoboiPanel.titleSearch')], ['sid', tx('patterns.shoboiPanel.time')]] as const).map(([k, l]) => (
            <Pressable key={k} onPress={() => { setTab(k); setResults(null); setError(''); }} style={[styles.tab, tab === k && { backgroundColor: accent.primary }]}>
              <T mono size={9} w={700} color={tab === k ? '#fff' : theme.mute}>{l}</T>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={onClose} style={[styles.close, { backgroundColor: theme.surface2, borderColor: theme.line }]}><T size={11} dim>×</T></Pressable>
      </View>
      <View style={[styles.form, { borderBottomColor: theme.line }]}>
        <View style={styles.row}>
          {tab === 'title' ? (
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={searchTitle} placeholder={tx('patterns.shoboiPanel.titleKeyword')} placeholderTextColor={theme.mute} style={[...input, styles.grow]} />
          ) : (
            <>
              <TextInput value={sid} onChangeText={setSid} placeholder="SID" placeholderTextColor={theme.mute} style={[...input, styles.sid]} />
              <TextInput value={startTime} onChangeText={setStartTime} placeholder="YYYY-MM-DD HH:MM" placeholderTextColor={theme.mute} style={[...input, styles.grow]} />
            </>
          )}
          <Pressable onPress={tab === 'title' ? searchTitle : searchSid} disabled={loading} style={[styles.go, { backgroundColor: accent.primary }]}>
            <T mono size={10} w={800} color="#fff">{loading ? '…' : tx('patterns.shoboiPanel.search')}</T>
          </Pressable>
        </View>
        {!!error && <T mono size={10} color={danger} style={styles.mt4}>{error}</T>}
      </View>
      <ScrollView automaticallyAdjustKeyboardInsets style={styles.grow} contentContainerStyle={styles.results} nestedScrollEnabled>
        {loading && empty(tx('common.searching'))}
        {!loading && results === null && empty(tx('patterns.shoboiPanel.searchSomething'))}
        {!loading && results?.type === 'title' && (results.data.length === 0 ? empty(tx('patterns.shoboiPanel.noResults')) : results.data.map((r) => {
          const i = info[r.tid];
          const wt = stripTitleType(i?.wiki_title);
          const rt = stripTitleType(r.title);
          const rst = stripTitleType(r.short_title);
          return (
            <View key={r.tid} style={[styles.item, { borderBottomColor: theme.line }]}>
              <Pressable onPress={() => openTitle(r.tid)} style={styles.itemHead}>
                <View style={styles.grow}>
                  <T size={12} w={700} numberOfLines={1}>{rt}</T>
                  <T mono size={9} dim>{`TID:${r.tid}${rst ? ` · ${rst}` : ''}${r.first_year ? ` · ${r.first_year}年` : ''}`}</T>
                </View>
                <T size={9} dim>{sel === r.tid ? '▲' : '▼'}</T>
              </Pressable>
              {sel === r.tid && detail([
                { label: 'TID', value: String(r.tid), btns: [['→アクション', { type: 'tid', value: String(r.tid) }]] },
                linkRow(r.tid, i?.wiki_url, wt),
                rt && { label: tx('library.musicSort.title'), value: rt, btns: set2(rt) },
                rst && { label: tx('patterns.shoboiPanel.short'), value: rst, btns: set2(rst) },
                r.title_yomi && { label: tx('patterns.shoboiPanel.reading'), value: r.title_yomi, btns: [['→furigana', { type: 'setStr', field: 'furigana', str: r.title_yomi }]] },
                r.title_en && { label: tx('patterns.shoboiPanel.english'), value: r.title_en, btns: set2(r.title_en) },
                i === null && { label: 'Wiki', value: tx('patterns.shoboiPanel.fetching'), btns: [] },
                wt && { label: 'Wiki', value: wt, btns: set2(wt) },
              ])}
            </View>
          );
        }))}
        {!loading && results?.type === 'sid' && (results.data.length === 0 ? empty(tx('patterns.shoboiPanel.noResults')) : results.data.map((p, idx) => {
          const key = p.pid || `s${idx}`;
          const pt = stripTitleType(p.title);
          const pst = stripTitleType(p.short_title);
          const pwt = stripTitleType(p.wiki_title);
          return (
            <View key={key} style={[styles.item, { borderBottomColor: theme.line }]}>
              <Pressable onPress={() => setSel((s) => (s === key ? null : key))} style={styles.itemHead}>
                <View style={styles.grow}>
                  <T size={11} w={700}>{p.episode_str || (p.count ? `#${p.count}` : pt)}</T>
                  <T mono size={9} dim numberOfLines={1}>{`${pt}${p.subtitle ? ` · ${p.subtitle}` : ''} · TID:${p.tid} · ${(p.start_time || '').slice(0, 16)}`}</T>
                </View>
                <T size={9} dim>{sel === key ? '▲' : '▼'}</T>
              </Pressable>
              {sel === key && detail([
                { label: 'TID', value: String(p.tid), btns: [['→アクション', { type: 'tid', value: String(p.tid) }]] },
                linkRow(p.tid, p.wiki_url, pwt),
                pt && { label: tx('library.musicSort.title'), value: pt, btns: set2(pt) },
                pst && { label: tx('patterns.shoboiPanel.short'), value: pst, btns: set2(pst) },
                p.title_yomi && { label: tx('patterns.shoboiPanel.reading'), value: p.title_yomi, btns: [['→furigana', { type: 'setStr', field: 'furigana', str: p.title_yomi }]] },
                p.title_en && { label: tx('patterns.shoboiPanel.english'), value: p.title_en, btns: set2(p.title_en) },
                p.subtitle && { label: tx('common.subtitle'), value: p.subtitle, btns: [['→getShoboiSubtitle', { type: 'getShoboiSubtitle', field: 'subtitle', tid: String(p.tid), episodeField: 'episode' }]] },
                pwt && { label: 'Wiki', value: pwt, btns: set2(pwt) },
              ])}
            </View>
          );
        }))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { height: 380, borderBottomWidth: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1 },
  tabs: { flex: 1, flexDirection: 'row', gap: 3, borderRadius: 8, padding: 3, borderWidth: 1 },
  tab: { flex: 1, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center' },
  close: { width: 26, height: 26, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  form: { paddingVertical: 8, paddingHorizontal: 14, borderBottomWidth: 1 },
  row: { flexDirection: 'row', gap: 6 },
  input: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  sid: { width: 70 },
  go: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  mt4: { marginTop: 4 },
  results: { paddingVertical: 4, paddingHorizontal: 14 },
  empty: { textAlign: 'center', padding: 16 },
  item: { borderBottomWidth: 1 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  detail: { backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 6 },
  dRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
  dLabel: { width: 52 },
  link: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
});
