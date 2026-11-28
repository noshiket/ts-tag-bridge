import type { MsgKey } from '@tstag/core';
import { genreOptions, pickService, typeStation, type Place } from '@tstag/core';
import { TextInput, View } from 'react-native';

import { Chip, Label, formStyles as fs, useAddInput } from './addVideoParts';
import { ManualVideoDetails } from './ManualVideoDetails';
import type { AddVideoState } from './useAddVideo';
import { VideoSourcePicker } from './VideoSourcePicker';
import { DateInput } from '../../../ui/inputs/DateInput';
import { HistoryInput } from '../../../ui/inputs/HistoryInput';
import { Select } from '../../../ui/inputs/Select';
import { SuggestInput } from '../../../ui/inputs/SuggestInput';
import { T } from '../../../ui/parts/T';
import { useTheme } from '../../../ui/theme/Tweaks';
import { useT } from '../../../ui/i18n/I18n';

const PLACES: [Place, MsgKey, MsgKey][] = [['keep', 'library.manualVideoFields.leave', 'library.manualVideoFields.registerWhere'], ['move', 'common.move', 'library.manualVideoFields.moveIntoLibrary'], ['copy', 'state.enc.file_copy', 'library.manualVideoFields.copyKeepingOriginal']];

/**
 * 動画追加の入力: 動画の場所・置き方（そのまま/移動/コピー）・パス形式・アルバム・シリーズ・話数・番組名・局・放送日時・ジャンル・ふりがな。
 * カテゴリと詳細は ManualVideoDetails
 */
export function ManualVideoFields({ a }: { a: AddVideoState }) {
  const { t: tx } = useT();
  const { theme } = useTheme();
  const input = useAddInput();
  const { form, set } = a;
  return (
    <>
      <VideoSourcePicker a={a} />
      {a.src === 'upload' && !!form.file_path && <T mono size={9} dim style={fs.hint}>{tx('library.manualVideoFields.uploaded', { v0: form.file_path })}</T>}
      {a.src === 'path' && (
        <>
          <Label req>{tx('library.manualVideoFields.videoLocationAbsolutePath')}</Label>
          <HistoryInput histKey="video_path" value={form.file_path} onChangeText={set('file_path')} placeholder={tx('common.1TitleMp4')} style={input} />
          <Label>{tx('library.manualVideoFields.whatDoFile')}</Label>
          <View style={fs.row6}>
            {PLACES.map(([k, l, sub]) => <Chip key={k} on={a.place === k} sub={tx(sub)} onPress={() => { a.setPlace(k); a.clearMsg(); }}>{tx(l)}</Chip>)}
          </View>
          {a.place !== 'keep' && (
            <>
              <Label req>{tx('library.manualVideoFields.destinationDirectoryUnderEncode')}</Label>
              <Select label={tx('common.destination')} value={a.destDir} options={a.rootOpts} onChange={a.setDestDir} />
              <T mono size={9} dim style={fs.hint}>{tx('library.manualVideoFields.folderFileNamesCome')}</T>
            </>
          )}
        </>
      )}
      <Label>{tx('library.manualVideoFields.pathFormatAppOutput')}</Label>
      <TextInput value={form.app_output_path_format} onChangeText={set('app_output_path_format')} multiline autoCapitalize="none" autoCorrect={false}
        placeholder="{$encode_dir}/{$folder}/[{$service_name}]{$title}_#{$episode_number}_{$setting}{$start_time}{$ext}" placeholderTextColor={theme.mute}
        style={[input, fs.mono, fs.area]} />
      <T mono size={9} dim style={fs.hint}>{tx('library.manualVideoFields.defaultsOutputPathConfig')}</T>

      <Label>{tx('library.manualVideoFields.albumFolder')}</Label>
      <SuggestInput value={form.folder} onChangeText={set('folder')} options={a.albums.map((x) => x.name)} placeholder={tx('library.manualVideoFields.titlePickExistingAlbum')} style={input} />
      <Label>{tx('library.manualVideoFields.seriesTitle')}</Label>
      <SuggestInput value={form.title} onChangeText={set('title')} options={a.seriesOpts} placeholder={tx('library.manualVideoFields.titleIncludingSeasonEtc')} style={input} />
      {!!a.seriesOpts.length && <T mono size={9} dim style={fs.hint}>{tx('library.manualVideoFields.suggestingSeries', { v0: form.folder.trim(), v1: a.seriesOpts.length })}</T>}
      <View style={fs.row8}>
        <View style={fs.f1}><Label>{tx('library.manualVideoFields.episodeEpisodeNumber')}</Label><TextInput value={form.episode_number} onChangeText={set('episode_number')} placeholder="1" placeholderTextColor={theme.mute} style={input} /></View>
        <View style={fs.f2}><Label>{tx('library.manualVideoFields.episodeTitleEpisodeName')}</Label><TextInput value={form.episode_name} onChangeText={set('episode_name')} style={input} /></View>
      </View>
      <Label>{tx('library.manualVideoFields.programTitleEitTitle')}</Label>
      <TextInput value={form.eit_title} onChangeText={set('eit_title')} style={input} />
      {/* 局は一覧から選ぶ（局名と onid/tsid/sid が一緒に入り、局のロゴと他のサーバーとの重複の判定が効く） */}
      <Label>{tx('library.manualVideoFields.stationEitStationName')}</Label>
      <Select label={tx('common.station')} value={a.svcKey} onChange={(v) => { a.setSvcKey(v); a.setForm((f) => pickService(f, a.svcs, v)); a.clearMsg(); }}
        options={[{ value: '', label: tx('library.manualVideoFields.selectTypeBelow') }, ...a.svcs.map((sv) => ({ value: `${sv.onid}-${sv.tsid}-${sv.sid}`, label: sv.service_name }))]} />
      <View style={fs.mt4}>
        <SuggestInput value={form.eit_station_name} options={a.known.map((x) => x.name)} placeholder={tx('library.manualVideoFields.typeStationNotList')} style={input}
          onChangeText={(name) => { const r = typeStation(form, name, a.known, a.svcs); a.setSvcKey(r.key); a.setForm(r.form); a.clearMsg(); }} />
      </View>
      <T mono size={9} dim style={fs.hint}>
        {form.sid ? tx('library.manualVideoFields.broadcastIdsOnidSet', { v0: form.onid || 0, v1: form.tsid || 0, v2: form.sid })
          : tx('library.manualVideoFields.stationNameNotList')}
      </T>
      <View style={fs.row8}>
        <View style={fs.f1}><Label>{tx('library.manualVideoFields.broadcastStartEitStart')}</Label><DateInput withTime value={form.eit_start_time} onChangeText={set('eit_start_time')} placeholder="2026-07-17T00:00:00" style={input} /></View>
        <View style={fs.f1}><Label>{tx('library.manualVideoFields.broadcastEndEitEnd')}</Label><DateInput withTime value={form.eit_end_time} onChangeText={set('eit_end_time')} placeholder="2026-07-17T00:30:00" style={input} /></View>
      </View>
      <Label>{tx('library.manualVideoFields.genreEitGenre')}</Label>
      <SuggestInput value={form.eit_genre} onChangeText={set('eit_genre')} options={genreOptions(a.genres)} placeholder={tx('library.manualVideoFields.animeDomesticAnimePick')} style={input} />
      <T mono size={9} dim style={fs.hint}>{tx('library.manualVideoFields.separateMultipleCommas')}</T>
      <Label>{tx('library.manualVideoFields.readingFurigana')}</Label>
      <TextInput value={form.furigana} onChangeText={set('furigana')} style={input} />
      <ManualVideoDetails a={a} />
    </>
  );
}
