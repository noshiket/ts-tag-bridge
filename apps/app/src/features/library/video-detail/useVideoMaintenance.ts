import { videoApplyParseBody, type Video } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useState } from 'react';

import { localSave } from '../../../lib/localSave/store';
import { useT } from '../../../ui/i18n/I18n';

/** 結果の一言が成功か（色を変える） */
export const okMsg = (m: string) => /^(反映|確定値へ|再解析しました|コメントを|サムネイルを)/.test(m);

/**
 * 動画の手入れ: 解析値の再解析（キャッシュ/取り直し）・確定値への反映（とファイルの移動）・
 * コメントの取り直し・サムネイルの作り直し（拾い直せなければ数分の仕事を2秒ごとに追う）
 */
export function useVideoMaintenance(video: Video, node: string | null, refresh: () => void) {
  const { t: tx } = useT();
  const api = useApi();
  const [reparsing, setReparsing] = useState<false | 'cache' | 'fresh'>(false);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const [cmtBusy, setCmtBusy] = useState(false);
  const [cmtMsg, setCmtMsg] = useState('');
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbMsg, setThumbMsg] = useState('');

  const reparse = async (fresh: boolean) => {
    if (reparsing) return;
    setReparsing(fresh ? 'fresh' : 'cache');
    setApplyMsg('');
    try {
      const r = await api.videoActions.reparse(video.id, fresh, node);
      const n = r?.text_parser_result?.parser_error?.length ?? 0;
      setApplyMsg(n ? `再解析しました(解析エラー ${n}件あり)` : tx('library.useVideoMaintenance.reparsed'));
    } catch (e) { setApplyMsg(e instanceof Error ? e.message : tx('library.useVideoMaintenance.reparseFailed')); } finally { setReparsing(false); }
  };
  // 今の確定値の上に解析値を重ねて保存し、続けてフォルダ・パスの変更を実際のファイルへ（移動先に同じ名前があれば保存だけ残る）
  const applyParse = async () => {
    if (applying) return;
    setApplying(true);
    setApplyMsg('');
    try {
      const rv = await api.videoActions.confirmed(video.id, node);
      await api.confirmed.saveVideo(video.id, videoApplyParseBody(rv.confirmed ?? {}, rv.parseResult ?? {}), node);
      let msg = tx('library.useVideoMaintenance.appliedConfirmedValues');
      try {
        const res = await api.videoActions.relocate(video.id, node);
        localSave.afterRelocate(res, video.id, node);
        if (res?.relocated || res?.updated) { msg = res.relocated ? '反映してファイルを移動しました' : tx('library.useVideoMaintenance.appliedReRegistered'); refresh(); }
      } catch (e) {
        msg = tx('library.useVideoMaintenance.confirmedValuesSavedMove', { v0: e instanceof Error ? e.message : e });
      }
      setApplyMsg(msg);
    } catch (e) { setApplyMsg(e instanceof Error ? e.message : tx('library.useVideoMaintenance.applyFailed')); } finally { setApplying(false); }
  };
  const refetchComments = async () => {
    if (cmtBusy) return;
    setCmtBusy(true);
    setCmtMsg('');
    try {
      const r = await api.videoActions.refetchComments(video.id, node);
      setCmtMsg(r.updated ? `コメントを ${r.before} → ${r.after}件に更新しました` : `増えませんでした(${r.after}件)`);
    } catch (e) { setCmtMsg(e instanceof Error ? e.message : tx('library.useVideoMaintenance.couldntRefetchComments')); } finally { setCmtBusy(false); }
  };
  // サムネイルが出ない原因はパスのずれが多いので、サーバーはまず正しい名前のファイルを拾い直す。無ければ作り直す（数分かかる仕事）
  const regenThumb = async () => {
    if (thumbBusy) return;
    setThumbBusy(true);
    setThumbMsg('');
    try {
      const r = await api.videoActions.regenerateThumbnail(video.id, node);
      if (r.fixed === 'path' || !r.job_id) { setThumbMsg(tx('library.useVideoMaintenance.thumbnailRePicked')); setThumbBusy(false); refresh(); return; }
      setThumbMsg(tx('library.useVideoMaintenance.regeneratingTakesFewMinutes'));
      const iv = setInterval(async () => {
        try {
          const j = await api.videoActions.audioJob(r.job_id!, node);
          if (j.state === 'running' || j.state === 'queued') return;
          clearInterval(iv);
          setThumbBusy(false);
          if (j.state === 'done') { setThumbMsg(tx('library.useVideoMaintenance.thumbnailsRegenerated')); refresh(); } else setThumbMsg(j.error || tx('library.useVideoMaintenance.regenerationFailed'));
        } catch { clearInterval(iv); setThumbBusy(false); setThumbMsg(tx('library.useVideoMaintenance.couldntGetStatus')); }
      }, 2000);
    } catch (e) { setThumbMsg(e instanceof Error ? e.message : tx('library.useVideoMaintenance.regenerationFailed')); setThumbBusy(false); }
  };

  return { reparsing, applying, applyMsg, cmtBusy, cmtMsg, thumbBusy, thumbMsg, reparse, applyParse, refetchComments, regenThumb };
}
