import { PERM_NETS, PERM_SCREENS, groupNetAllowed, groupServices, permsBody, togglePerm, toggleStationGroup, type AdminUser, type Service, type UserPerms } from '@tstag/core';
import { useApi, useNodes } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { T } from '../../../ui/parts/T';
import { monoFamily } from '../../../ui/theme/theme';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';
import { Chip, H, Row } from './permParts';

/**
 * 利用者ごとの見せる範囲（元の user_perms.jsx の UserPermEditor）: 画面・サーバー・放送局（許可する一覧）、
 * 隠すカテゴリ（NG の一覧）、変更できるか。放送局はこのサーバーと他のサーバーの局を合わせて出す
 */
export function UserPermEditor({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t: tx } = useT();
  const api = useApi();
  const { theme, accent } = useTheme();
  const [perms, setPerms] = useState<UserPerms | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [catQuery, setCatQuery] = useState('');
  useEffect(() => { api.admin.perms(user.id).then(setPerms).catch((e: Error) => setMsg(e.message)); }, [api, user.id]);
  const cats = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api.admin.categories() });
  const peers = useNodes();
  const services = useQuery({
    queryKey: ['admin', 'allServices', (peers.data?.nodes ?? []).map((n) => n.name).join(',')],
    enabled: !!peers.data,
    queryFn: async () => {
      const lists = await Promise.all([
        api.epg.services(null).catch(() => [] as Service[]),
        ...(peers.data?.nodes ?? []).map((n) => api.epg.services(n.name).then((l) => l.map((s) => ({ ...s, _node: n.name }))).catch(() => [])),
      ]);
      return lists.flat();
    },
  });

  // 番組表のアドオン（このサーバーとほかのサーバーの物。名前で許可する）
  const guideAddons = useQuery({
    queryKey: ['admin', 'guideAddons', (peers.data?.nodes ?? []).map((n) => n.name).join(',')],
    enabled: !!peers.data,
    queryFn: async () => {
      const lists = await Promise.all([null, ...(peers.data?.nodes ?? []).map((n) => n.name)]
        .map((n) => api.autoAdd.addons('guide', n).catch(() => [])));
      const seen = new Map<string, string>();
      for (const a of lists.flat()) if (!a.error && !seen.has(a.name)) seen.set(a.name, a.label || a.name);
      return [...seen].map(([name, label]) => ({ name, label }));
    },
  });

  if (!perms) return <T mono size={10} dim style={styles.loading}>{msg || tx('common.loading')}</T>;
  const netLabel = (n: string) => (n === 'GR' ? tx('settings.userPermEditor.netGR') : n === 'BS' ? tx('settings.userPermEditor.netBS')
    : n === 'CS' ? tx('settings.userPermEditor.netCS') : tx('settings.userPermEditor.netOther'));
  // 見出しの数: 波ごとの許可は名前で、個別の局は数で（例: BS（全部） + 3局）
  const singles = perms.stations.filter((v) => !v.startsWith('net:')).length;
  const stationSummary = [...PERM_NETS.filter((n) => perms.stations.includes(`net:${n}`)).map(netLabel),
    ...(singles || !perms.stations.length ? [tx('settings.userPermEditor.stations2', { n: singles })] : [])].join(' + ');
  const set = (patch: Partial<UserPerms>) => setPerms((p) => (p ? { ...p, ...patch } : p));
  const groups = groupServices(services.data ?? []);
  const allStations = perms.stations.includes('*');
  const denied = perms.deny_categories ?? [];
  const shownCats = (cats.data ?? []).filter((c) => !catQuery || (c.name || '').toLowerCase().includes(catQuery.toLowerCase()));
  const nodes = peers.data?.nodes ?? [];
  const guides = perms.guides ?? [];
  const guideNames = guideAddons.data ?? [];

  const save = async () => {
    setBusy(true);
    setMsg('');
    try { setPerms(await api.admin.savePerms(user.id, permsBody(perms))); setMsg(tx('common.saved')); } catch (e) { setMsg(e instanceof Error ? e.message : tx('common.couldntSave')); } finally { setBusy(false); }
  };

  return (
    <View style={[styles.wrap, { borderTopColor: theme.line, backgroundColor: theme.surface2 }]}>
      <H hint={tx('settings.userPermEditor.onlyAllowedScreensAppear')}>{tx('settings.userPermEditor.screens')}</H>
      <Row>
        {PERM_SCREENS.map((s) => (
          <Chip key={s.id} on={perms.screens.includes(s.id) || perms.screens.includes('*')} onPress={() => set({ screens: togglePerm(perms.screens, s.id) })}>{s.label}</Chip>
        ))}
        <Chip on={perms.screens.includes('*')} onPress={() => set({ screens: perms.screens.includes('*') ? [] : ['*'] })}>{tx('settings.userPermEditor.all')}</Chip>
      </Row>

      <H hint={tx('settings.userPermEditor.whetherTheySeeOther')}>{tx('common.servers')}</H>
      <Row>
        {nodes.length === 0 && <T mono size={9} dim>{tx('settings.userPermEditor.noPeers')}</T>}
        {nodes.map((n) => (
          <Chip key={n.name} on={perms.nodes.includes(n.name) || perms.nodes.includes('*')} onPress={() => set({ nodes: togglePerm(perms.nodes, n.name) })}>{n.name}</Chip>
        ))}
      </Row>

      <H hint={tx('settings.userPermEditor.guidesHint')}>{tx('settings.userPermEditor.guides')}</H>
      <Row>
        {guideNames.length === 0 && <T mono size={9} dim>{tx('settings.userPermEditor.noGuides')}</T>}
        {guideNames.map((g) => (
          <Chip key={g.name} on={guides.includes(g.name) || guides.includes('*')} onPress={() => set({ guides: togglePerm(guides, g.name) })}>{g.label}</Chip>
        ))}
        {guideNames.length > 0 && <Chip on={guides.includes('*')} onPress={() => set({ guides: guides.includes('*') ? [] : ['*'] })}>{tx('settings.userPermEditor.all')}</Chip>}
      </Row>

      <H hint={tx('settings.userPermEditor.appliesGuideReservationsRecordings')}>{tx('settings.userPermEditor.stations', { v0: allStations ? tx('settings.userPermEditor.all2') : stationSummary })}</H>
      <Row>
        <Chip on={allStations} onPress={() => set({ stations: allStations ? [] : ['*'] })}>{tx('settings.userPermEditor.all')}</Chip>
        {/* 波ごと（地デジ・BS・CS・その他）。局が増えても付いてくる。その他は配信の取り込みなど、局の決まらない物 */}
        {!allStations && PERM_NETS.map((n) => (
          <Chip key={n} on={perms.stations.includes(`net:${n}`)} onPress={() => set({ stations: togglePerm(perms.stations, `net:${n}`) })}>{netLabel(n)}</Chip>
        ))}
      </Row>
      <Row>
        {!allStations && groups.filter((g) => !groupNetAllowed(perms.stations, g)).map((g) => (
          <Chip key={g.key} on={g.ids.every((id) => perms.stations.includes(id))} onPress={() => set({ stations: toggleStationGroup(perms.stations, g) })}>
            {`${g.label}${g.sub ? ` (${g.sub})` : ''}`}
            {!g.nodes.includes('') && <T mono size={8} style={styles.nodes}>{` ${g.nodes.join('/')}`}</T>}
          </Chip>
        ))}
      </Row>

      <H hint={tx('settings.userPermEditor.categoriesListedHereHidden')}>{tx('settings.userPermEditor.blockedCategories', { v0: denied.length })}</H>
      {denied.length > 0 && (
        <View style={styles.mb5}>
          <Row>
            {denied.map((id) => (
              <Chip key={id} danger on onPress={() => set({ deny_categories: denied.filter((v) => v !== id) })}>
                {`${cats.data?.find((c) => c.id === id)?.name ?? `#${id}`} ×`}
              </Chip>
            ))}
          </Row>
        </View>
      )}
      <TextInput value={catQuery} onChangeText={setCatQuery} placeholder={tx('settings.userPermEditor.searchCategoriesAdd')} placeholderTextColor={theme.mute} autoCorrect={false}
        style={[styles.input, { borderColor: theme.line, backgroundColor: theme.surface, color: theme.ink }]} />
      {!!catQuery && (
        <ScrollView automaticallyAdjustKeyboardInsets style={styles.cats} nestedScrollEnabled>
          <Row>
            {shownCats.slice(0, 60).map((c) => (
              <Chip key={c.id} danger on={denied.includes(c.id)}
                onPress={() => set({ deny_categories: denied.includes(c.id) ? denied.filter((v) => v !== c.id) : [...denied, c.id] })}>{c.name}</Chip>
            ))}
            {shownCats.length === 0 && <T mono size={9} dim>{tx('common.noMatches')}</T>}
          </Row>
        </ScrollView>
      )}

      <H hint={tx('settings.userPermEditor.paidHint')}>{tx('settings.userPermEditor.paid')}</H>
      <Row>
        <Chip on={!!perms.paid} onPress={() => set({ paid: !perms.paid })}>{perms.paid ? tx('settings.userPermEditor.paidOn') : tx('settings.userPermEditor.paidOff')}</Chip>
      </Row>

      <H hint={tx('settings.userPermEditor.whenOffTheyCant')}>{tx('common.menu')}</H>
      <Row>
        <Chip on={!!perms.can_write} onPress={() => set({ can_write: !perms.can_write })}>{perms.can_write ? tx('settings.userPermEditor.change') : tx('settings.userPermEditor.viewOnly')}</Chip>
      </Row>

      <View style={styles.actions}>
        <Pressable onPress={() => void save()} disabled={busy} style={[styles.save, { backgroundColor: accent.primary, opacity: busy ? 0.5 : 1 }]}>
          <T mono size={11} w={700} color="#fff">{tx('common.save')}</T>
        </Pressable>
        <Pressable onPress={onClose} style={[styles.close, { borderColor: theme.line }]}>
          <T mono size={11} dim>{tx('common.close')}</T>
        </Pressable>
        {!!msg && <T mono size={9} color={msg === '保存しました' ? theme.mute : '#ef4444'}>{msg}</T>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 8, paddingHorizontal: 13 },
  wrap: { paddingVertical: 10, paddingHorizontal: 13, borderTopWidth: 1 },
  mb5: { marginBottom: 5 },
  nodes: { opacity: 0.7 },
  input: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, fontSize: 11, fontFamily: monoFamily[400] },
  cats: { maxHeight: 150, marginTop: 5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  save: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 8 },
  close: { paddingVertical: 6, paddingHorizontal: 13, borderRadius: 8, borderWidth: 1 },
});
