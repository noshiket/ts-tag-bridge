import { mockParse, withAddedTitle, type ParsePreview as Preview } from '@tstag/core';
import { useParsePreview, type ParseInput } from '@tstag/core/react';
import { router } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { setPatternCtx } from '../../lib/state/patternCtx';
import { oklch } from '../../ui/theme/oklch';
import { SectionTitle } from '../../ui/parts/SectionTitle';
import { T } from '../../ui/parts/T';
import { monoFamily } from '../../ui/theme/theme';
import { useTheme } from '../../ui/theme/Tweaks';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/** 複数話まとめの番組では、この2つだけが話数分の並びになる（text_parser の _COMBINE_FIELDS） */
const PER_EP_KEYS = ['episode_number', 'episode_name'];
const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v));

/**
 * 解析プレビュー（元の parse.jsx の ParsePreview）。題名がどのパターンに当たり、何が取れるか。
 * 構造は合うが switch に未登録の値は、その場で足した見本を出せる（保存はしない。元と同じ）。
 * 「パターン登録 →」は既定でパターン画面へ（再生画面からは onGotoPattern でパターンタブへ切り替える）
 */
export function ParsePreview({ input, node = null, adoptedIdx = -1, compact, ctxId, onGotoPattern }: {
  input: ParseInput;
  /** 予約・録画・動画のサーバー。そのサーバーのパターンで解析する（実際の解析と同じ結果にする） */
  node?: string | null;
  /** パターン画面の CONTEXT に出す番号（予約・録画の番号） */
  ctxId?: string | number;
  onGotoPattern?: () => void;
  /** この動画が採用している話（複数話まとめの時） */
  adoptedIdx?: number;
  compact?: boolean;
}) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const q = useParsePreview(input, node);
  const [local, setLocal] = useState<Preview | null>(null);
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState({ title: '', folder: '', type: '' });
  useEffect(() => { setLocal(null); setAdding(false); }, [q.data]);
  if (!q.data) return null;
  const parse = local ?? q.data.preview;
  const color = { matched: oklch(0.6, 0.2, 145), unregistered: oklch(0.65, 0.2, 55), nomatch: oklch(0.6, 0.22, 25) }[parse.status];
  const label = { matched: 'MATCHED', unregistered: 'UNREGISTERED', nomatch: 'NO MATCH' }[parse.status];

  const gotoPattern = onGotoPattern ?? (() => {
    setPatternCtx({
      id: String(ctxId ?? ''), title: input.title, service_name: input.service_name, sid: input.sid ?? undefined, onid: input.onid ?? undefined,
      tsid: input.tsid ?? undefined, start: input.start_time ?? '', description: input.description, extended_info: input.extended_info,
    });
    router.push('/patterns');
  });
  const confirmAdd = () => {
    if (parse.status !== 'unregistered') return;
    const next = withAddedTitle(q.data.patterns, parse.pattern, parse.newValue, fields);
    setLocal(mockParse(q.data.normTitle, next));
    setAdding(false);
  };

  return (
    <View style={styles.wrap}>
      <SectionTitle>{tx('detail.parsePreview.parsePreview')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
        <View style={[styles.bar, { backgroundColor: color }]}>
          <T mono size={10} w={800} color="#fff" style={styles.ls}>{label}</T>
          {parse.status !== 'nomatch' ? <T mono size={9} color="rgba(255,255,255,0.75)" numberOfLines={1} style={styles.grow}>{parse.pattern}</T> : <View style={styles.grow} />}
          <Pressable onPress={gotoPattern} style={styles.goto}><T mono size={9} w={800} color="#fff">{tx('detail.parsePreview.registerPattern')}</T></Pressable>
        </View>
        {parse.status === 'matched' && <Matched p={parse} adoptedIdx={adoptedIdx} compact={compact} />}
        {parse.status === 'unregistered' && (
          <View style={styles.body}>
            <T size={12} style={styles.lh}>
              {tx('detail.parsePreview.pattern')}<T mono size={11}>{parse.pattern}</T>{tx('detail.parsePreview.matchedStructureBut')}
              <T size={12} w={700}>{`「${parse.newValue}」`}</T>{tx('detail.parsePreview.isntRegisteredSwitchCase')}
            </T>
            {!adding ? (
              <Pressable onPress={() => { setFields({ title: parse.newValue, folder: parse.newValue, type: '' }); setAdding(true); }}
                style={[styles.addBtn, { backgroundColor: accent.primary }]}>
                <T mono size={12} w={800} color="#fff">{tx('detail.parsePreview.addPattern', { v0: parse.newValue })}</T>
              </Pressable>
            ) : (
              <View style={[styles.form, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
                <T mono size={10} w={700} dim>{tx('detail.parsePreview.enterExtraInfo')}</T>
                {([['title', tx('detail.parsePreview.titleTitle')], ['folder', tx('detail.parsePreview.folderFolder')], ['type', tx('detail.parsePreview.typeTypeAnime')]] as const).map(([k, ph]) => (
                  <View key={k} style={styles.field}>
                    <T mono size={9} dim>{k}</T>
                    <TextInput value={fields[k]} onChangeText={(v) => setFields((f) => ({ ...f, [k]: v }))} placeholder={ph} placeholderTextColor={theme.mute}
                      style={[styles.input, { borderColor: theme.frame, backgroundColor: theme.bg, color: theme.ink }]} />
                  </View>
                ))}
                <View style={styles.formRow}>
                  <Pressable onPress={confirmAdd} style={[styles.formBtn, { backgroundColor: accent.primary }]}><T size={12} w={800} color="#fff">{tx('common.register')}</T></Pressable>
                  <Pressable onPress={() => setAdding(false)} style={[styles.formBtn, styles.cancel, { borderColor: theme.frame }]}><T size={12} w={700}>{tx('common.cancel')}</T></Pressable>
                </View>
              </View>
            )}
          </View>
        )}
        {parse.status === 'nomatch' && (
          <View style={styles.nomatch}>
            <T size={12} dim style={styles.nomatchText}>{tx('detail.parsePreview.noPatternMatchesRegister')}</T>
            <Pressable onPress={gotoPattern} style={[styles.gotoBig, { backgroundColor: theme.ink }]}><T size={12} w={800} color={theme.onInk}>{tx('detail.parsePreview.goPatternRegistration')}</T></Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function Matched({ p, adoptedIdx, compact }: { p: Extract<Preview, { status: 'matched' }>; adoptedIdx: number; compact?: boolean }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const entries = Object.entries(p.result).filter(([k]) => !k.startsWith('_'));
  const epCount = Math.max(1, ...PER_EP_KEYS.map((k) => (Array.isArray(p.result[k]) ? (p.result[k] as unknown[]).length : 1)));
  const multi = epCount > 1;
  const common = multi ? entries.filter(([k]) => !PER_EP_KEYS.includes(k)) : entries;
  return (
    <View style={styles.body}>
      <View style={compact ? styles.listCompact : styles.list}>
        {common.map(([k, v]) => (
          <Fragment key={k}>
            <View style={compact ? undefined : styles.kv}>
              <T mono size={9} w={700} dim style={compact ? undefined : styles.key}>{k}</T>
              {/* 値は残りの幅を全部使う。iOS の選べる文字（range）は後から長くなっても幅を測り直さず、途中で切れていた */}
              <T range size={12} w={700} style={compact ? styles.shrink : styles.val}>{fmt(v)}</T>
            </View>
          </Fragment>
        ))}
        {!!(p.result._sid_lookup || p.result._sid_ep_lookup) && <T mono size={9} w={700} color={accent.primary}>{tx('detail.parsePreview.callPlanned')}</T>}
      </View>
      {multi && (
        <View style={[styles.sub, { borderTopColor: theme.line }]}>
          <T mono size={9} dim style={styles.subTitle}>{tx('detail.parsePreview.episodes', { v0: epCount })}</T>
          {Array.from({ length: epCount }, (_, i) => (
            <View key={i} style={[styles.ep, {
              backgroundColor: i === adoptedIdx ? `${accent.primary}22` : theme.surface2, borderColor: i === adoptedIdx ? accent.primary : theme.line,
            }]}>
              <T mono size={9} w={700} dim>{`#${i + 1}`}</T>
              {PER_EP_KEYS.map((k) => {
                const v = p.result[k];
                const one = Array.isArray(v) ? v[i] : i === 0 ? v : null;
                return one == null ? null : <T range key={k} size={12} w={700} style={styles.shrink}>{fmt(one)}</T>;
              })}
              {i === adoptedIdx && <T mono size={8} w={800} color={accent.primary} style={styles.adopted}>{tx('common.use')}</T>}
            </View>
          ))}
        </View>
      )}
      <View style={[styles.sub, { borderTopColor: theme.line }]}>
        <T mono size={9} dim style={styles.subTitle}>{tx('detail.parsePreview.groups')}</T>
        <View style={styles.groups}>
          {Object.entries(p.groups).map(([k, v]) => (
            <View key={k} style={[styles.group, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <T mono size={10}><T mono size={10} style={styles.half}>{`${k}=`}</T>{v}</T>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  card: { borderWidth: 1.5, borderRadius: 16, overflow: 'hidden' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14 },
  ls: { letterSpacing: 1 },
  grow: { flex: 1 },
  body: { paddingVertical: 10, paddingHorizontal: 14 },
  list: { gap: 4 },
  listCompact: { gap: 6 },
  kv: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  key: { width: 110, paddingTop: 2 },
  shrink: { flexShrink: 1 },
  val: { flex: 1, minWidth: 0 },
  sub: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderStyle: 'dashed', gap: 4 },
  subTitle: { marginBottom: 4 },
  ep: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1 },
  adopted: { marginLeft: 'auto' },
  groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  group: { paddingVertical: 2, paddingHorizontal: 7, borderRadius: 5, borderWidth: 1 },
  half: { opacity: 0.5 },
  lh: { lineHeight: 18, marginBottom: 8 },
  addBtn: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  form: { borderRadius: 12, padding: 12, borderWidth: 1, gap: 6 },
  field: { gap: 2 },
  input: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, fontSize: 11, fontFamily: monoFamily[400] },
  formRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  formBtn: { flex: 1, padding: 9, borderRadius: 10, alignItems: 'center' },
  cancel: { borderWidth: 1.5 },
  nomatch: { alignItems: 'center', padding: 14 },
  nomatchText: { textAlign: 'center', lineHeight: 18, marginBottom: 10 },
  goto: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  gotoBig: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10 },
});
