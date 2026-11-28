import type { ShoboiInfo } from '@tstag/core';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { T } from '../../ui/parts/T';
import { useTheme } from '../../ui/theme/Tweaks';
import { MetaGrid, MetaRow } from './MetaRow';
import { shadow } from '../../ui/theme/edge';
import { useT } from '../../ui/i18n/I18n';

/** しょぼいカレンダーの番組表・作品情報から引いたこの放送の情報（最初は畳んでおく。元の ShoboiInfoPanel） */
export function ShoboiInfoPanel({ info }: { info: ShoboiInfo | null | undefined }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  if (info == null) return null;
  const ep = info.count ? tx('detail.shoboi.epN', { n: info.count }) : '';
  const summary = info.tid ? [info.title || `TID ${info.tid}`, ep].filter(Boolean).join(' ') : tx('detail.shoboiInfoPanel.notProgramCalendarsListings');
  const link = (url: string | null | undefined, text: string) => (
    <Pressable onPress={() => url && void Linking.openURL(url)} style={styles.shrink}>
      <T mono size={11} w={700} style={styles.link}>{text}</T>
    </Pressable>
  );
  const hm = (s?: string | null) => (s || '').slice(5, 16).replace('-', '/');
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((o) => !o)} style={[styles.head, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 2) }]}>
        <T mono size={10} dim>{open ? '▼' : '▶'}</T>
        <T mono size={10} w={800} style={styles.ls}>SYOBOCAL</T>
        <T mono size={11} color={info.tid ? theme.ink : theme.mute} numberOfLines={1} style={styles.shrink}>{summary}</T>
      </Pressable>
      {open && !!info.tid && (
        <View style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.frame, boxShadow: shadow(theme, 3) }]}>
          <MetaGrid>
            <MetaRow label={tx('detail.shoboiInfoPanel.title')} value={info.title
              ? <View style={styles.inline}>{link(info.url, info.title)}{info.short_title && info.short_title !== info.title ? <T mono size={11} w={700}>{tx('detail.shoboiInfoPanel.parenthesized', { v0: info.short_title })}</T> : null}</View>
              : link(info.url, `TID ${info.tid}`)} />
            {!!info.title_yomi && <MetaRow label={tx('detail.shoboiInfoPanel.reading')} value={info.title_yomi} />}
            {!!(ep || info.subtitle) && <MetaRow label={tx('detail.shoboiInfoPanel.episode')} value={[ep, info.subtitle && `「${info.subtitle}」`].filter(Boolean).join(' ')} />}
            {!!info.st_time && <MetaRow label={tx('detail.shoboiInfoPanel.air')} value={`${hm(info.st_time)} 〜 ${(info.ed_time || '').slice(11, 16)}`} />}
            {!!info.prog_comment && <MetaRow label={tx('detail.shoboiInfoPanel.note')} value={info.prog_comment} />}
            {!!info.wiki_url && <MetaRow label="WIKIPEDIA" value={link(info.wiki_url, info.wiki_title || info.wiki_url)} />}
            <MetaRow label="TID / PID" value={`${info.tid} / ${info.pid || '-'}`} />
          </MetaGrid>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 12 },
  ls: { letterSpacing: 0.5 },
  shrink: { flexShrink: 1 },
  box: { marginTop: 6, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 16 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  link: { textDecorationLine: 'underline' },
});
