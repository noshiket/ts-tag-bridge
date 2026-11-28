import { addManualBody, addResultMessage, emptyAddVideoForm, type AddVideoForm, type KnownStation, type Place, type Service } from '@tstag/core';
import { useApi } from '@tstag/core/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { pickVideoFile, uploadPicked, type Picked } from './uploadPicked';
import { useT } from '../../../ui/i18n/I18n';

/**
 * 動画追加・tagビデオ追加の状態と操作: 入力、動画の指定の仕方（パス / アップロード）と置き方、保存先、カテゴリ、
 * 候補（アルバム・シリーズ・局・ジャンル・保存先）、ファイル選び・アップロード・登録。登録先はこのサーバーのライブラリ
 */
export function useAddVideo(mode: 'manual' | 'tag', open: boolean, onAdded: () => void, preset?: Partial<AddVideoForm>) {
  const { t: tx } = useT();
  const api = useApi();
  const manual = mode === 'manual';
  const web = Platform.OS === 'web';
  const [form, setForm] = useState<AddVideoForm>(() => ({ ...emptyAddVideoForm(), ...preset }));
  const [src, setSrc] = useState<'path' | 'upload'>('path');
  const [place, setPlace] = useState<Place>('keep');
  const [svcKey, setSvcKey] = useState('');
  const [destDir, setDestDir] = useState('');
  const [upFile, setUpFile] = useState<Picked | null>(null);
  const [upPct, setUpPct] = useState<number | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const [catDraft, setCatDraft] = useState('');
  const [tagPath, setTagPath] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const roots = useQuery({ queryKey: ['addVideo', 'roots'], queryFn: () => api.addVideo.uploadRoots(), enabled: open });
  const defaults = useQuery({ queryKey: ['addVideo', 'defaults'], queryFn: () => api.addVideo.manualDefaults(), enabled: open && manual });
  // 登録先はこのサーバーのライブラリなので、候補もこのサーバーから
  const albums = useQuery({ queryKey: ['library', '', 'albums'], queryFn: () => api.library.albums(null), enabled: open && manual });
  const services = useQuery({ queryKey: ['epg', '', 'services'], queryFn: () => api.epg.services(null), enabled: open && manual });
  const genres = useQuery({ queryKey: ['contentTypes'], queryFn: () => api.addVideo.contentTypes(), enabled: open && manual });
  const known: KnownStation[] = defaults.data?.stations ?? [];
  const svcs: Service[] = services.data ?? [];
  // シリーズの候補は、打ったアルバム名が既存のアルバムと同じ時だけ
  const album = albums.data?.find((a) => a.name === form.folder.trim());
  const seriesOpts = useQuery({
    queryKey: ['library', '', 'album', album?.id ?? 0], enabled: !!album,
    queryFn: () => api.library.album(album!.id, null),
    select: (d) => d.series.map((x) => x.name).filter(Boolean),
  });
  useEffect(() => {
    const f = defaults.data?.app_output_path_format;
    if (f) setForm((p) => (p.app_output_path_format ? p : { ...p, app_output_path_format: f }));
  }, [defaults.data]);

  const clearMsg = () => setMsg(null);
  const set = (k: keyof AddVideoForm) => (v: string) => { setForm((p) => ({ ...p, [k]: v })); clearMsg(); };
  const addCat = () => { const v = catDraft.trim(); if (!v) return; setCats((l) => (l.includes(v) ? l : [...l, v])); setCatDraft(''); clearMsg(); };
  const pickFile = async () => {
    try { const f = await pickVideoFile(web); if (f || web) { setUpFile(f); clearMsg(); } } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : tx('library.useAddVideo.couldntPickFile') }); }
  };
  const doUpload = async () => {
    if (!upFile || !destDir || busy) return;
    setBusy(true); clearMsg(); setUpPct(0);
    try {
      // 行き先は渡さない（サーバーの一時置き場に入る。置き場所は登録の時に決まる）
      const r = await uploadPicked(api.addVideo.uploadUrl(upFile.name), api.client.authHeaders(), upFile, setUpPct);
      if (manual) setForm((f) => ({ ...f, file_path: r.file_path })); else setTagPath(r.file_path);
      setMsg({ ok: true, text: tx('library.useAddVideo.uploaded', { v0: r.file_path }) });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : tx('common.uploadFailed') }); } finally { setBusy(false); setUpPct(null); }
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true); clearMsg();
    try {
      const r = manual
        ? await api.addVideo.addManual(addManualBody(form, cats, place, src === 'upload', destDir))
        : await api.addVideo.addFromTag(tagPath, replace, src === 'upload' ? destDir : '');
      setMsg(addResultMessage(r));
      onAdded();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : tx('library.useAddVideo.registrationFailed') }); } finally { setBusy(false); }
  };
  const rootOpts = [{ value: '', label: tx('library.useAddVideo.pleaseSelect') }, ...(roots.data ?? []).map((r) => ({ value: r.path, label: `${r.path}${r.exists ? '' : '（未マウント）'}` }))];

  return {
    manual, form, setForm, set, src, setSrc, place, setPlace, svcKey, setSvcKey, destDir, setDestDir, upFile, upPct, cats, setCats, catDraft, setCatDraft, addCat,
    tagPath, setTagPath, replace, setReplace, busy, msg, clearMsg, known, svcs, albums: albums.data ?? [], seriesOpts: seriesOpts.data ?? [], genres: genres.data ?? [],
    rootOpts, pickFile, doUpload, submit, canSubmit: !busy && (manual ? !!form.file_path.trim() : !!tagPath.trim()),
  };
}

export type AddVideoState = ReturnType<typeof useAddVideo>;
