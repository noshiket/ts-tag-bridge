import type { AlbumDetail, Series } from '@tstag/core';
import { usePrefs } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { usePrivateMode } from '../../../lib/state/privateMode';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { AddVideoSheet } from '../add-video/AddVideoSheet';
import { PurgeAlbumSheet, RenameSheet } from '../AlbumSheets';
import { ImportMusicSheet } from '../ImportMusicSheet';
import { useT } from '../../../ui/i18n/I18n';

/**
 * アルバムの「…」（元のアルバムの中のメニュー）と、そこから開くシート。書き換える操作はこのサーバーのアルバムだけ
 * （動画の追加はいつもこのサーバーへ）: フォルダ名・シリーズ名の変更、動画追加・tagビデオ追加・音楽の取り込み、プライベートモード、削除
 */
export function AlbumMenuSheets({ open, onClose, albumId, album, active, node, onSeriesRenamed, back }: {
  open: boolean; onClose: () => void; albumId: number; album: AlbumDetail | undefined; active: Series | undefined; node: string | null;
  onSeriesRenamed: (newId: number) => void; back: () => void;
}) {
  const { t: tx } = useT();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<null | 'folder' | 'series' | 'purge' | 'manual' | 'tag' | 'music'>(null);
  const privCats = usePrefs(true).data?.private_categories ?? [];
  const [privMode, setPrivMode] = usePrivateMode();
  const reload = () => { void qc.invalidateQueries({ queryKey: ['library'] }); };
  const openSheet = (k: NonNullable<typeof sheet>) => { onClose(); setSheet(k); };
  const allVideos = (album?.series ?? []).flatMap((x) => x.videos);
  const activeCount = active ? album?.series.find((x) => x.id === active.id)?.videos.length : undefined;
  return (
    <>
      <Sheet open={open} onClose={onClose} title={album?.name ?? ''}>
        {!node && album && <SheetItem first label={tx('common.renameFolder')} sub={tx('library.albumMenuSheets.moveAllVideosTogether')} onPress={() => openSheet('folder')} />}
        {!node && active && <SheetItem label={tx('common.renameSeries')} sub={tx('library.albumMenuSheets.changeAllVideos', { v0: active.name, v1: activeCount ?? active.videos.length })} onPress={() => openSheet('series')} />}
        <SheetItem first={!!node} label={tx('library.menu.addVideo')} sub={tx('library.menu.addVideoSub')} onPress={() => openSheet('manual')} />
        <SheetItem label={tx('library.menu.addTag')} sub={tx('library.menu.addTagSub')} onPress={() => openSheet('tag')} />
        <SheetItem label={tx('library.menu.music')} sub={tx('library.menu.musicSub')} onPress={() => openSheet('music')} />
        <SheetItem label={privMode ? tx('library.menu.privateOn') : tx('library.menu.private')}
          sub={privCats.length ? `非公開カテゴリ${privCats.length}件の動画も表示` : tx('library.menu.privateNone')}
          onPress={() => { if (!privCats.length) return; onClose(); setPrivMode(!privMode); }} />
        {!node && album && <SheetItem danger label={tx('library.album.menu.delete')} sub={tx('library.album.menu.deleteSub')} onPress={() => openSheet('purge')} />}
      </Sheet>
      {sheet === 'music' && <ImportMusicSheet open onClose={() => setSheet(null)} onDone={reload} />}
      {/* 動画追加は、開いているアルバムと選んでいるシリーズを埋めておく（このサーバーのアルバムの時だけ。動画はいつもこのサーバーへ入る） */}
      {(sheet === 'manual' || sheet === 'tag') && <AddVideoSheet key={sheet} mode={sheet} open onClose={() => setSheet(null)} onAdded={reload}
        preset={!node && album ? { folder: album.name, title: active?.name ?? '' } : undefined} />}
      {album && (
        <>
          <RenameSheet key={`f${albumId}${sheet}`} kind="folder" id={albumId} current={album.name} open={sheet === 'folder'} onClose={() => setSheet(null)}
            onDone={(newId) => { setSheet(null); reload(); if (newId && newId !== albumId) router.replace({ pathname: '/album/[id]', params: { id: String(newId) } }); }} />
          {active && (
            <RenameSheet key={`s${active.id}${sheet}`} kind="series" id={active.id} current={active.name} videoCount={activeCount}
              open={sheet === 'series'} onClose={() => setSheet(null)} onDone={(newId) => { setSheet(null); reload(); if (newId) onSeriesRenamed(newId); }} />
          )}
          <PurgeAlbumSheet key={`p${albumId}${sheet}`} albumId={albumId} name={album.name} videoCount={allVideos.length}
            folders={[...new Set(allVideos.map((v) => v.folder).filter((f): f is string => !!f))]}
            open={sheet === 'purge'} onClose={() => setSheet(null)} onDone={() => { setSheet(null); reload(); back(); }} />
        </>
      )}
    </>
  );
}
