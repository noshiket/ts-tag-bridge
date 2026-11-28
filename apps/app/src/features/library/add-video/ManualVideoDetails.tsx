import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Label, formStyles as fs, useAddInput } from './addVideoParts';
import type { AddVideoState } from './useAddVideo';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

/** 動画追加のカテゴリ（省略時はアルバム名）と、畳んである詳細（番組情報・放送識別・録画時刻・設定など） */
export function ManualVideoDetails({ a }: { a: AddVideoState }) {
  const { t: tx } = useT();
  const { theme, accent } = useTheme();
  const input = useAddInput();
  const [more, setMore] = useState(false);
  const { form, set } = a;
  const pair = (l1: string, k1: keyof typeof form, l2: string, k2: keyof typeof form, auto?: boolean) => (
    <View style={fs.row8}>
      <View style={fs.f1}><Label>{l1}</Label><TextInput value={String(form[k1])} onChangeText={set(k1)} autoCapitalize={auto ? 'none' : undefined} style={input} /></View>
      <View style={fs.f1}><Label>{l2}</Label><TextInput value={String(form[k2])} onChangeText={set(k2)} autoCapitalize={auto ? 'none' : undefined} style={input} /></View>
    </View>
  );
  return (
    <>
      <Label>{tx('library.manualVideoDetails.categoriesAlbumNameIf')}</Label>
      {a.cats.length > 0 && (
        <View style={styles.cats}>
          {a.cats.map((c, i) => (
            <View key={`${c}-${i}`} style={[styles.cat, { backgroundColor: theme.surface2, borderColor: theme.line }]}>
              <T size={11}>{c}</T>
              <Pressable onPress={() => a.setCats((l) => l.filter((_, j) => j !== i))} accessibilityLabel={tx('library.manualVideoDetails.remove')}><T size={12} dim>×</T></Pressable>
            </View>
          ))}
        </View>
      )}
      <View style={fs.row6}>
        <TextInput value={a.catDraft} onChangeText={(v) => { a.setCatDraft(v); a.clearMsg(); }} onSubmitEditing={a.addCat} placeholder={tx('library.manualVideoDetails.categoryName')} placeholderTextColor={theme.mute} style={[input, fs.f1]} />
        <Pressable onPress={a.addCat} disabled={!a.catDraft.trim()} style={[styles.plus, { backgroundColor: a.catDraft.trim() ? accent.primary : theme.line }]}><T mono size={14} w={800} color="#fff">{tx('common.plus')}</T></Pressable>
      </View>

      <Pressable onPress={() => setMore(!more)} style={[styles.more, { borderColor: theme.line }]}>
        <T mono size={10} w={700}>{more ? tx('library.manualVideoDetails.hideDetails') : tx('library.manualVideoDetails.detailsProgramInfoBroadcast')}</T>
      </Pressable>
      {more && (
        <>
          <Label>{tx('library.manualVideoDetails.summaryEitDescription')}</Label>
          <TextInput value={form.eit_description} onChangeText={set('eit_description')} style={input} />
          <Label>{tx('library.manualVideoDetails.detailsEitExtendedInfo')}</Label>
          <TextInput value={form.eit_extended_info} onChangeText={set('eit_extended_info')} multiline style={[input, fs.area70]} />
          {pair(tx('library.manualVideoDetails.videoEitVideoInfo'), 'eit_video_info', tx('library.manualVideoDetails.audioEitAudioInfo'), 'eit_audio_info')}
          {/* onid/tsid/sid は局で決まるので入力は置かない。eid は分かる時だけ */}
          <Label>eid</Label>
          <TextInput value={form.eid} onChangeText={set('eid')} keyboardType="number-pad" style={input} />
          {pair(tx('library.manualVideoDetails.recordingStartRecordingStart'), 'recording_start_time', tx('library.manualVideoDetails.recordingEndRecordingEnd'), 'recording_end_time', true)}
          <Label>{tx('library.manualVideoDetails.settingSetting')}</Label>
          <TextInput value={form.setting} onChangeText={set('setting')} placeholder={tx('library.manualVideoDetails.newCc')} placeholderTextColor={theme.mute} style={input} />
          <Label>{tx('library.manualVideoDetails.announcementAnnounce')}</Label>
          <TextInput value={form.announce} onChangeText={set('announce')} style={input} />
          {pair(tx('library.manualVideoDetails.tagEdcbTag'), 'edcb_tag', tx('common.destinationEncodeDir'), 'encode_dir', true)}
        </>
      )}
      <T mono size={9} dim style={fs.note}>
        {tx('library.manualVideoDetails.fileSizeDurationFilled')}
      </T>
    </>
  );
}

const styles = StyleSheet.create({
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 5 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  plus: { paddingHorizontal: 16, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  more: { marginTop: 10, padding: 8, borderRadius: 9, borderWidth: 1, alignItems: 'center' },
});
