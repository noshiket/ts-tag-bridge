import type { AlbumSummary } from '@tstag/core';
import { usePrefs } from '@tstag/core/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { usePrivateMode } from '../../../lib/state/privateMode';
import { Sheet, SheetItem } from '../../../ui/sheets/Sheet';
import { AddVideoSheet } from '../add-video/AddVideoSheet';
import { PurgeAlbumSheet } from '../AlbumSheets';
import { ImportMusicSheet } from '../ImportMusicSheet';
import { useT } from '../../../ui/i18n/I18n';

/**
 * ライブラリのシート: 右上の「…」（動画追加・tagビデオ追加・音楽の取り込み・プライベートモード）と、
 * アルバムの「…」（開く・マイリスト・削除）、そこから開く追加・取り込み・削除のシート
 */
export function LibrarySheets({ libMenu, closeLibMenu, menuAlbum, setMenuAlbum, inMylist, toggleMylist, openAlbum }: {
  libMenu: boolean; closeLibMenu: () => void;
  menuAlbum: AlbumSummary | null; setMenuAlbum: (a: AlbumSummary | null) => void;
  inMylist: (id: number) => boolean; toggleMylist: (id: number, on: boolean) => void; openAlbum: (a: AlbumSummary) => void;
}) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['library'] });
  const [purgeAlbum, setPurgeAlbum] = useState<AlbumSummary | null>(null);
  const [addSheet, setAddSheet] = useState<null | 'manual' | 'tag' | 'music'>(null);
  const privCats = usePrefs(true).data?.private_categories ?? [];
  const [privMode, setPrivMode] = usePrivateMode();
  const add = (k: 'manual' | 'tag' | 'music') => { closeLibMenu(); setAddSheet(k); };
  const { t: tx } = useT();
  return (
    <>
      {purgeAlbum && (
        <PurgeAlbumSheet albumId={purgeAlbum.id} name={purgeAlbum.name} videoCount={purgeAlbum.video_count}
          folders={purgeAlbum.folder_mismatch?.length ? purgeAlbum.folder_mismatch : purgeAlbum.dirs ?? []}
          open onClose={() => setPurgeAlbum(null)} onDone={() => { setPurgeAlbum(null); refresh(); }} />
      )}
      {addSheet === 'music' && <ImportMusicSheet open onClose={() => setAddSheet(null)} onDone={refresh} />}
      {(addSheet === 'manual' || addSheet === 'tag') && <AddVideoSheet key={addSheet} mode={addSheet} open onClose={() => setAddSheet(null)} onAdded={refresh} />}
      <Sheet open={libMenu} onClose={closeLibMenu} title={tx('library.menu.title')}>
        {/* 指定が無くても出す（隠すと、指定する入口のカテゴリの「…」に気づけない） */}
        <SheetItem first label={tx('library.menu.addVideo')} sub={tx('library.menu.addVideoSub')} onPress={() => add('manual')} />
        <SheetItem label={tx('library.menu.addTag')} sub={tx('library.menu.addTagSub')} onPress={() => add('tag')} />
        <SheetItem label={tx('library.menu.music')} sub={tx('library.menu.musicSub')} onPress={() => add('music')} />
        <SheetItem label={tx(privMode ? 'library.menu.privateOn' : 'library.menu.private')}
          sub={privCats.length ? tx('library.menu.privateSub', { n: privCats.length }) : tx('library.menu.privateNone')}
          onPress={() => { if (!privCats.length) return; closeLibMenu(); setPrivMode(!privMode); }} />
      </Sheet>
      <Sheet open={!!menuAlbum} onClose={() => setMenuAlbum(null)} title={menuAlbum?.name ?? ''} subtitle={tx('library.album.count', { n: menuAlbum?.video_count ?? 0 })}>
        {menuAlbum && (
          <>
            <SheetItem first label={tx('library.album.menu.open')} sub={tx('library.album.menu.openSub')} onPress={() => { setMenuAlbum(null); openAlbum(menuAlbum); }} />
            <SheetItem label={tx(inMylist(menuAlbum.id) ? 'library.album.mylistRemove' : 'library.album.mylistAdd')} sub={tx('library.album.menu.mylistSub')}
              onPress={() => { setMenuAlbum(null); toggleMylist(menuAlbum.id, !inMylist(menuAlbum.id)); }} />
            <SheetItem danger label={tx('library.album.menu.delete')} sub={tx('library.album.menu.deleteSub')}
              onPress={() => { setPurgeAlbum(menuAlbum); setMenuAlbum(null); }} />
          </>
        )}
      </Sheet>
    </>
  );
}
